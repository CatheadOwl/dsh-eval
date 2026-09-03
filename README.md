---
description: dsh-plugin eval 框架：模型无关的试验设计层 + dsh headless 执行适配层
---

# dsh-plugin eval 框架

本包把 **试验是什么** 与 **通过什么 agent runtime 执行** 分开：

```text
plugin-owned experiment             shared framework
fixtures + prompt + rubric + observe ──► experiment/review.mjs
                                              │ task
                                              ▼
                                       adapters/dsh/review.mjs ──► dsh headless

behavior *.eval.mjs ───────────────────► dsh behavior runner (trace + mock)
```

- `src/experiment/` 是模型与 runtime 无关的试验设计层：定义 blind review、实时生成观测、保证多次 reviewer 看到字节一致的证据。它不 import dsh。
- `src/adapters/dsh/` 是 review 的落地层：把抽象任务交给隔离的 dsh headless。行为 harness 保留自己的 trace runner，因为它的断言对象就是 dsh session 事件投影。
- plugin 的 `eval/` 只保留本领域 fixture、projection/observe、prompt、rubric 与行为 case，不复制 runner。

## Eval 类型与责任边界

| 类型 | 问题 | 判定 | 执行 |
|---|---|---|---|
| 单元/shape test | 确定性字段和值是否正确 | 自动 | plugin 自己的 `node:test` |
| behavior real | 自然语言意图是否选到正确工具 | trace matcher | dsh + 真实模型 |
| behavior mock | 工具管线与写入 round-trip 是否稳定 | trace matcher + workspace inspect | dsh + 脚本化 mock LLM |
| comprehension review | 一个 fresh model 能否从输出理解含义和下一步 | 人工对照 rubric，多次收敛 | 抽象 review experiment + 可替换 executor；当前 adapter 为 dsh |

理解评审不尝试用 trace matcher 自动化，因为“缺少应有提示”“字段容易误读”是设计缺口，不是固定字符串回归。相反，行为层不负责评价自由文本设计。

行为层的断言对象是 session 事件投影，不只是「模型产出」：`requestHeaders` 已投影模型被挂载的工具与 system prompt（输入面），`userMessages` 补上 user-role 的模型可见输入面（任务 prompt、插件 steer、注入上下文）。这让 behavior mock 能断言插件的**驱动级 steer**——例如 gates「归责过滤后只 steer 自己文件」——而不只断工具选择或最终文本。steer 在持久化日志里没有专名事件（`agent.steer()` 落为 `user/message`），所以区分靠 `source`（gates 为 `{ kind: 'plugin', plugin: 'gates' }`，任务 prompt 为 `{ kind: 'user' }`），由 `userMessageTextIncludes` / `userMessageTextExcludes` 的 `source` matcher 承担。

## 从早期 eval 固化下来的规则

1. **冻结输入，实时投影输出。** fixture 保存 raw SDK result、合成知识库或调用参数；`observe()` 必须调用当前构建产物。不要提交一份会随实现漂移的 projected-output 快照。
2. **盲 prompt 与隐藏 rubric 分离。** `prompt.md` 只能含问题和 `{{EVAL_OBSERVATIONS}}`；答案键、预期 next action、intentional design 只在 `rubric.md`。
3. **一次物化，多次独立评审。** 同一批运行共享完全相同的 task，避免把 fixture 波动误判成模型分歧；每次调用新的 headless 进程和隔离的临时 `DSH_HOME`，但暂存所选 profile 的配置与依赖链接。
4. **主动标准化非语义噪声。** 临时绝对路径、时间戳等应在 plugin 的 observation projection 中替换或移除，同时保留真实字段名与语义。
5. **显式登记 intentional design。** reviewer 提出的 red flag 只有不在该清单中时才是新发现，避免反复争论已接受取舍。
6. **生成物不做 SSOT。** `.runs/` 只用于当次人工审阅，gitignore 使用无路径前缀的 `.runs/`，覆盖任意深度。

## 规范目录

```text
<plugin>/eval/
  .gitignore                 # .runs/
  README.md
  behavior/                  # 可选
    real/*.eval.mjs
    mock/*.eval.mjs
    _fixtures/
  comprehension/             # 可选
    <name>.review.mjs
    fixtures.json
    prompt.md
    rubric.md
```

当前迁移实例：[`any_routes/eval/`](../extras/modules/routes/eval/README.md) 与 [`coggit/eval/`](../coggit/eval/README.md)。

## 理解实验定义

```js
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineReviewExperiment } from '../../../eval/src/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export default defineReviewExperiment({
  id: 'my-output-comprehension',
  summary: 'Can a fresh model infer the next action?',
  prompt: readFileSync(join(here, 'prompt.md'), 'utf8'),
  rubric: join(here, 'rubric.md'),
  defaultRuns: 3,
  async observe() {
    const liveOutput = await projectFrozenFixtureWithCurrentBuild()
    return [{
      heading: 'Scenarios',
      entries: [{ heading: 'case-1', call: { path: 'x' }, json: liveOutput }],
    }]
  },
})
```

抽象层公开 `defineReviewExperiment`、`materializeReviewExperiment`、`executeReviewExperiment` 与标准 observation renderer。自定义 executor 只需实现 `(task, context) => result`；因此以后接入别的 agent runtime 不需要改试验定义。

### dsh review CLI

```bash
# dry-run 不要求 profile 或已构建 dsh CLI
node bin/dsh-review.mjs --dry-run <experiment file or directory>

node bin/dsh-review.mjs \
  --profile <sterile-profile> \
  --repo ../../deepseek-harness \
  [--runs 5] [--timeout 300000] \
  <experiment file or directory>
```

真实运行使用**专用 sterile profile**（默认 `headless`，即宿主模板 `dsh-base` + `dsh-headless`，无树外插件）：适配器生成一份 `--patch` 覆盖层禁用所有宿主模型可见工具（`tool-fs`、`tool-fs-search`、shell、web、subagent 等），并把 cwd 指向空临时目录——reviewer 只能从物化的观测文本推理。运行后解析 session trace 的 `request/header` 事件做**工具边界校验**：发现任何非预期工具即视为 adapter failure（证据写入 `.runs/<id>/run-N.tool-boundary-evidence.json`）。

> **运维前提**：`stageProfileStore` 在真实 home 已有同名 profile 时**原样复制**（含已安装插件与 patch 层）。若本机 `~/.dsh/profiles/headless` 装过树外插件，暂存后的 profile **不是无菌的**——工具边界校验会当场 fail-loud（这是设计的正确行为）。保持无菌的方式：删掉本机 `headless` profile 让 boot 重建出厂模板，或指定一个确认无插件的 profile。

产物落在 review 文件旁的 `.runs/<experiment id>/`：

- `observations.md`：本次实时物化的可见证据；
- `task.txt`：实际发给每位 reviewer 的完整任务；
- `run-N.txt` / stderr / error：各次独立运行；
- `run.json`：experiment、rubric、adapter、profile 与 run 数；
- `review-report.md`：判读报告骨架（product-review P4）——机器字段自动填（experiment/adapter/profile/runs、observations 指纹、rubric 位置、每轮 reviewer 原文），三个**人工判读栏目**留白待填：intentional design 命中项、新 red flag、下一步（改输出 / 改 rubric / 改 behavior case / 不处理）。刻意不做自动评分——review 层的价值在人工判断，报告只把判断物化成可归档、可对比的工程证据（dry-run 也会生成，runs 记 0）。

## Behavior case

`<plugin>/eval/behavior/**/*.eval.mjs` default export case 或 case 数组：

```js
import { firstTool, toolCalled, toolCallStep, textStep } from '../../../../eval/src/index.mjs'

export default {
  id: 'my-intent-case',
  mode: 'real', // real | mock
  task: '自然语言任务',
  async prepare(workspace) {},
  async inspect(workspace, { trace }) {},
  script: { steps: [toolCallStep('x', {}), textStep('done')] }, // mock 必填
  disableRows: ['gates'], // 可选；见下方「disableRows 与 turn-close 门禁边界契约」
  timeoutMs: 300_000, // 可选；默认 180s，探索前置的发现式 case 放宽
  expect: [firstTool('x'), toolCalled('x')],
}
```

### disableRows 与 turn-close 门禁边界契约

`disableRows: string[]` 是通用机制：按 loader 行 id 在本次 run 的 overlay 里禁用任意插件
行（`- id: <row> / disabled: true`，与 `session-title-llm` 同一跨层禁用机制）。框架对行
id 无任何内置知识，任何插件都可以成为禁用对象。

它的首要使用场景是 turn-close blocking gate：gate 会在 turn 收尾自动运行并向 inbox splice
反馈。当 case 的**终态本身**就是 gate 判违规的状态（skip 语义的断链现场、conflict 现场
等），splice 会驱动模型产生脚本之外的额外 step，`finalText*` 断言随之失效。契约：

- 默认**不声明** = 所选 profile 装载的插件照常运行（gate 交互 case——如断言 gates steer
  的 `userMessageTextIncludes`——依赖此默认）。
- case 声明 `disableRows: ['gates']` = 本次 run 禁用 gates 插件行（行 id 权威：
  `dsh-plugin-dev/extras/cordis.patch.yml` 的 `- id: gates`），终态违规不再触发 splice，
  `finalText` 保持「脚本终步文本」的确定性语义。适用于测插件工具面、不测 gate 交互的
  case。禁用其他插件行同理，id 以该插件 patch 声明为准。
- 不依赖插件开关的断言出口：`assistantTextIncludes`（断言脚本台词出现过，不要求是最终
  文本）。终态干净时仍应优先 `finalText*`。
- per-gate 白名单（如 `disableRows` 之外只关 gates 的某个 gate）暂不支持：per-gate
  disable 需要 gates 侧先提供 config 面；需要时先在 `workunits/eval` 登记。

matcher：`toolCalled`、`toolNotCalled`、`firstTool`、`toolSequence`、`toolCallArgs`、`toolResultFor`、`toolResultIsError`（匹配的工具调用结果 `isError === true`）、`toolResultSucceeded`（匹配的工具调用结果 `isError` 不为 true）、`toolResultTextIncludes`（匹配的工具调用结果文本含指定子串）、`finalTextIncludes`、`finalTextMatches`、`assistantTextIncludes`（任一 assistant 文本含指定子串——turn-close 门禁 splice 反馈步骤、`finalText*` 被截走时的 case 级出口，结构性问题见 [`workunits/eval/TODO/20260901-turnclose-gate-eval-interaction.md`](../../workunits/eval/TODO/20260901-turnclose-gate-eval-interaction.md)）、`systemPromptIncludes`（组装后的 system prompt 含指定子串）、`toolMounted`（工具出现在某个 request/header 的挂载列表）、`userMessageTextIncludes` / `userMessageTextExcludes`（按 `source` 过滤的 `user/message` 文本含/不含指定子串——`source` 用字符串/RegExp 匹配 `plugin` 名，或谓词取整个 `source`）。mock helper：`toolCallStep`、`textStep`。

### real 意图 case 规约

behavior real 断言「自然语言意图 → 工具选择与参数路由」，mock 断言「工具管线与写入 round-trip」：两层互补，不互相替代。宿主无关的**方法论上游**——为什么、触发表及其依据、case 设计规则、失败启发集——在 [`handbooks/agent-tools-dev/01-意图面-e2e.md`](../../handbooks/agent-tools-dev/01-意图面-e2e.md)；本节是它在 dsh 的承载面（触发速查 + matcher 落地 + CI 语义）。

**何时写**（上游触发表的 dsh 速查，依据与展开见上游 §2）：注册了模型可见工具（happy path ≥1）／目标存在等价手工路径／描述 steering 变更／分支由数据面状态分流（成对 case）／拒绝路径面向模型消费（remedy 委派边界）／有误触发风险（负向 `toolNotCalled`，先例 coggit `intent-unrelated`）。

**dsh 落地的断言与守卫**（上游规则的承载形态）：

- 断言面最小：`toolCalled`（不是 `firstTool`，探索在前合法）+ `toolCallArgs` 子集（路由 payoff 在参数对）+ 语义关键时 `toolResultTextIncludes` 状态锚（如 `"status": "repaired"`）；不约束措辞与中间步骤。
- `inspect` 守结果面 + 反捏造（不重建旧路径、不凭空造文件），不管模型走什么中间路径。
- fixture 可区分性与门禁交互规避等通用规则见上游 §3/§4。dsh 侧已知交互：turn-close 阻塞门禁会 splice 反馈步骤污染判读——契约与 `disableRows: ['gates']` 出口见上方「disableRows 与 turn-close 门禁边界契约」（结构性问题登记在 [`workunits/eval/TODO/20260901-turnclose-gate-eval-interaction.md`](../../workunits/eval/TODO/20260901-turnclose-gate-eval-interaction.md)，case 级出口为 `assistantTextIncludes`）。
- 无凭证 auto-skip；CI 门禁用 `--fail-on-skip` 防「根本没跑但成功」。

实例：`coggit/eval/behavior/real/`、`md-rename/eval/behavior/real/`（后者的 repair / discovery / no-evidence / oldpath-missing 四连是「同一意图 × 数据面分流」成对设计的范本）。

```bash
# 工作目录：本目录（dsh-plugin-dev/eval/）
node bin/dsh-eval.mjs run --profile <profile> --repo <deepseek-harness> \
  [--mode real|mock|all] [--keep-artifacts] [--fail-on-skip] \
  [--format text|json] [--report <file>] \
  <case file or directory...>
```

### 统一配置 dsh-eval.config.mjs

消费者包根放一份 `dsh-eval.config.mjs`，两个 CLI（`dsh-eval` / `dsh-review`）从工作目录向上查找（跳过 `node_modules`），flags 永远覆盖 config：

```js
export default {
  profile: 'headless',              // dsh profile
  repo: '../../deepseek-harness',   // 相对路径锚定 config 文件所在目录
  mode: 'mock',                     // behavior CLI 的 --mode 默认（review 无此项）
  failOnSkip: false,                // behavior CLI 默认
  report: 'eval-report.json',       // behavior CLI 的 --report 默认（锚定 config 目录）
}
```

package scripts 于是收敛为 `dsh-eval run --mode mock eval/behavior/mock` 这类形态（profile/repo 来自 config）。未知 key 直接报错（拼写错误不静默退化）。消费者接入实例：`coggit/`、`subagent-at/`、`extras/` 各自的 `dsh-eval.config.mjs`。

前置：被测插件须已装进所选 profile（`dsh plugin --profile <profile> add <插件目录>`，各插件 eval README 的「前置」节有实例）；`--repo` 指向的 harness 检出须已构建（`apps/cli/lib/bin.js`，缺失时 CLI 会以可读错误退出）。本包自身需要 `node_modules/@deepseek-ai/dsh-llm` junction 指向宿主检出（模块级 junction 层同机制；缺失时 mock adapter 以 loader entry import 失败拒载）。real 层在 staged 临时 home 下存在 `REQUEST_EXTENSION` 已知问题（嫌疑 `plugin-package-inventory-deepseek` × staged 环境），处置方向见 [`workunits/eval/TODO/20260901-staged-home-request-extension.md`](../../workunits/eval/TODO/20260901-staged-home-request-extension.md)。每条 behavior case 在隔离的临时 `DSH_HOME` 与 workspace 中启动 dsh，通过 `--patch` 把 session JSONL 定向到本次 run，随后解析 `tool/call`、`tool/result` 与最终文本。mock 会插入脚本化 `eval-mock` adapter，但工具执行仍走真实 Cordis/tool 管线。失败产物位于 case 旁 `.runs/<case id>/`。

`--fail-on-skip` 用于 CI 门禁：当选中 case > 0 但全部被 skip（无凭证或 `--mode` 过滤）时返回非零退出码，避免“根本没跑但成功”的误判。本地开发默认不启用，体验不变。

### 机器可读报告

`--format json`：stdout 只输出一个 JSON 报告对象（过程与失败明细转 stderr），供 CI / 多插件聚合消费；`--report <file>`：在任一格式下额外把同一报告对象写入文件。报告结构（构造在 `src/report.mjs`）：

```jsonc
{
  "tool": "dsh-eval",
  "profile": "headless", "repo": "<absolute harness checkout>",
  "mode": "mock", "failOnSkip": false,
  "startedAt": "…", "finishedAt": "…",
  "summary": { "selected": 1, "passed": 1, "failed": 0, "skipped": 0 },
  "results": [
    {
      "id": "…", "file": "…", "mode": "mock", "status": "pass",
      "exitCode": 0, "timedOut": false, "durationMs": 5000
      // fail 时另有 failures[]、artifactsDir；skip 时另有 skipReason；
      // case 文件加载失败/重复 id 这类文件级失败也进 results（无 mode 字段）
    }
  ]
}
```

status 取值 `pass | fail | skip`；退出码与文本格式完全一致（同一 `reportExitCode` 派生）。默认 `--format text` 输出逐字节不变。

runner 用 `try/finally` 保证临时目录与 junction 在任何路径（`prepare` 抛错、mock 校验失败、spawn 错误）都被清理，不会残留临时文件或泄漏到真实 profile store。

behavior 与 review CLI 共享 `src/discovery.mjs` 目录扫描，均跳过 `.runs` 与 `node_modules`。behavior CLI 在加载时做 case shape 校验（id / task / mode / expect matcher shape / mock script.steps），并在跨文件时检测重复 id，尽早失败而非运行期才报错。

## 自测与宿主证据

```bash
pnpm test
```

宿主 seam 的源溯登记在 [`explorer/eval-seams/`](../../explorer/eval-seams/summary.md)。dsh runner 依赖已构建的 `deepseek-harness/apps/cli/lib/bin.js`；real 层需要 `DEEPSEEK_API_KEY` 或 `$DSH_HOME/.credentials.yaml`，mock 与 review dry-run 不需要。

real 层还会以管道 stdio spawn 子 dsh CLI（headless 会话、子代理子运行时），因此需要一个能 spawn 子进程的运行面：受限文件沙箱内该 spawn 会被拒（`spawn EPERM`，凭证在也不够）——在 agent 会话内跑需要以更宽 sandbox 权限（升级 + 审批），或直接在宿主侧终端/CI 跑；提权是 real eval 的正常前置，不是异常（delegated subagent scope 无审批通道时不可升级，只能宿主侧或由父级升级执行）。mock 与 review dry-run 不 spawn 子 CLI，无此约束。

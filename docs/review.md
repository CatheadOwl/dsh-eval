---
description: comprehension review 指南——defineReviewExperiment 实验定义、空白环境（默认禁树外插件行）盲评运行、.runs 产物与 review-report 判读模板、六条评审规则
---

# Comprehension review

理解评审回答 behavior matcher 无法回答的问题：**一个 fresh model 能否从插件输出理解含义和下一步**。「缺少应有提示」「字段容易误读」是设计缺口，不是固定字符串回归——刻意不用 trace matcher 自动化；反过来，行为层不负责评价自由文本设计。

## 实验定义

`<plugin>/eval/comprehension/<name>.review.mjs`：

```js
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineReviewExperiment } from '@catheadowl/dsh-eval'

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

抽象层公开 `defineReviewExperiment`（稳定根入口）。实验执行与渲染原语——`materializeReviewExperiment`、`executeReviewExperiment`、标准 observation renderer（`renderObservationSections`；prompt 里的观测占位符常量是 `OBSERVATIONS_PLACEHOLDER`，必须恰好出现一次）——在 `@catheadowl/dsh-eval/experimental` 逃生面（见 [experimental.md](experimental.md)，无兼容承诺）。自定义 executor 只需实现 `(task, context) => result`；接入其他 agent runtime 不需要改试验定义。结果契约上，报告消费 `result.answer`（对任务的回答；未提供时回落 `result.stdout`），`result.stderr` 落盘为每轮 transcript——自定义 executor 提供这两者即可获得同等的产物与报告行为。

## CLI

```bash
# dry-run 不要求 profile 或已构建 dsh CLI
dsh-review --dry-run <experiment file or directory>

dsh-review \
  --profile <profile> \
  --repo <deepseek-harness checkout> \
  [--runs 5] [--timeout 300000] [--keep-plugin-rows] [--judge] \
  <experiment file or directory>
```

`--profile`/`--repo` 可来自 `dsh-eval.config.mjs`（见 README），flags 覆盖 config。`--judge` 追加机器第一道判读（见下节），要求真实运行（与 `--dry-run` 组合直接拒绝——dry-run 不碰模型）。

## Judge 第一道（`--judge`）

review 的判分规程写在每份 rubric 的判分节里，按设计由人执行；`--judge` 把这道规程交给机器做**第一道**：reviewer 跑完后，同一 executor（同一空白环境、同一 profile）再做一次 dispatch——judge 看到 rubric（答题人从未见过的答案钥匙）、byte-identical observations、全部成功 reviewer 的答案，按固定四节契约输出预填：

| 节 | 内容 |
|---|---|
| `Verdicts` | 逐 run：rubric 判据 understood / missed / uncertain + 引文；跨 run 一致与分歧 |
| `Intentional design hits` | 命中 rubric 的 intentional / accepted 清单的 reviewer flag（引 run + 原文 + 清单项） |
| `New red flags` | 清单外新发现——真正的 findings，各标注疑似来源（fixture / design / unclear） |
| `Next step` | 四选一建议（改输出 / 改 rubric / 加 behavior case / 不处理）+ 一行理由 |

纪律（「不伪装全自动」由**标注**达成，不由缺席达成）：

- **判定是证据不是门**：judge 结果不进退出码——review 恒不作 CI 门，机器判读同理。
- **仪器身份记账**：`run.json` 的 `judge` 字段记 `status`（`judged` / `unparsed` / `failed` / `not-executed`）+ profile + `judgedAt`；报告的 Judge first-pass 段自带 machine——prefill, not a verdict gate 标注。
- **不合格输出响亮记账**：judge 输出缺节 → `unparsed`（缺失节名进 `judge.json`，原文留 `judge.txt`），报告明示按 rubric 人工判读——不静默当作通过。
- **人工栏目仍是权威记录**：三个 human judgment 栏保留为 checklist；机器预填在它们上方单独渲染，人只裁增量（新 genuine 项），核对后勾选或覆写。

产物增补：`judge.txt`（judge 原文）、`judge.json`（解析后的预填或失败/未执行记账）。全部 reviewer 失败时 judge 记 `not-executed`。程序化消费走 `experimental` 子路径（`buildJudgeTask` / `executeReviewJudge` / `parseJudgeOutput` / `loadRubricText` / `JUDGE_OUTPUT_SECTIONS`，见 [experimental.md](experimental.md)）。

## 空白环境（默认）与工具边界

真实运行的 reviewer 会话默认在**空白环境**启动：适配器先照常暂存所选 profile，再枚举它组合出的**全部树外插件行**（`package.json` 的 `dsh.profile.bundles` 中非 `@deepseek-ai/*` 的 bundle 各自 patch 文件里的行，加上 profile 自有 `cordis.patch.yml` 的行），在 `--patch` overlay 里逐行禁用——宿主 profile 装了什么 gates/插件都与 reviewer 无关，可复现性不再依赖「本机 profile 恰好干净」。白名单保留 reviewer 起不来就无测可言的接线行（`agent-default-model`、`session-title-llm`、`system-prompt`、`session-persistence-jsonl`）；宿主模板工具行（`tool-fs`、shell、web、subagent 等）由静态清单继续禁用，cwd 指向空临时目录——reviewer 只能从物化的观测文本推理。overlay 同时钉死 session-log 工件形状（`overlaySessionLogRow`：root=该 run 的 `<DSH_HOME>/sessions` 收集根、`compression: none`，与 behavior 面同一行共享）——否则宿主默认 zstd 写出 `session.vN.jsonl.zstd`，trace 收不到，工具边界校验恒 `not-executed`（EVAL-030 前的形态）。运行后解析 session trace 的 `request/header` 事件做**工具边界校验**：发现任何非预期工具即视为 adapter failure（证据写入 `.runs/<id>/run-N.tool-boundary-evidence.json`）。

**校验没跑成也要记账**：收不到 session artifact（宿主 artifact 命名或会话格式换代是最常见的成因）时 `validateToolBoundary` 返回 `status: 'not-executed'` 而**不是**通过，适配器把该状态与 seam 诊断挂上执行结果；报告头写明 `tool boundary: NOT EXECUTED on run(s) N`，对应轮次的 `run-N.txt` 顶部与报告条目也各写一行原因，`run.json` 的 `toolBoundaries` 给机器读。这是有意的取向：**「没验证」必须看起来像没验证**——静默 fail-open 会让一份「工具边界从未检查过」的 review 产物读起来完全正常。

**刻意复用宿主插件面**（例如要评审某插件自己的 gate 行为）：加 `--keep-plugin-rows`——跳过树外行枚举，仅保留静态工具禁用，宿主 gates 恢复运行。

> 注意：无 `id` 的组合条目对 id 定位的禁用天然不可见（宿主 loader 语义），本包的树外 bundle 生态均为带 id 行形态；发现无 id 树外行时以工具边界校验 fail-loud 兜底。白名单是**按行名**无条件保留——若某树外 bundle 刻意以白名单名（如 `system-prompt`）insert 自己的行，该行不会被禁（威胁模型是本机自己的 profile，非对抗面）；此类泄漏同样由工具边界校验兜底。

## 产物

落在 review 文件旁的 `.runs/<experiment id>/`：

- `observations.md`：本次实时物化的可见证据；
- `task.txt`：实际发给每位 reviewer 的完整任务；
- `run-N.txt`：该轮 reviewer 的**答案**——trace 推导（首条插件注入消息之前的最后一条 assistant 文本，抗回合尾部劫持），无 trace 时回落到 stdout 的最终消息；劫持发生时原始最终消息另存 `run-N.stdout.txt`；工具边界校验未执行时，本条文件顶部先写一行 `[tool-boundary: NOT EXECUTED — <原因>]`（答案本身退回 stdout 的最终消息）；
- `run-N.stderr.txt` / error：完整会话转录（判读回溯的 transcript 指针，报告每轮引用）/ 失败原因；
- `run.json`：experiment、rubric、adapter、profile、run 数与每轮 `toolBoundaries` 记账（`checked` / `not-executed` + 原因）；
- `review-report.md`：判读报告骨架——机器字段自动填（experiment/adapter/ profile/runs、observations 指纹、rubric 位置、每轮 reviewer **答案**与 transcript 指针），三个 **人工判读栏目**留白待填：intentional design 命中项、新 red flag、下一步（改输出 / 改 rubric / 改 behavior case / 不处理）。刻意不做自动评分——review 层的价值在人工判断，报告只把判断物化成可归档、可对比的工程证据（dry-run 也会生成，runs 记 0）。

## 六条评审规则

每条形如「纪律 + 理由」，理由是废弃键——理由不再成立时重审规则，而不是默认永续。

1. **冻结输入，实时投影输出。** fixture 保存 raw SDK result、合成知识库或调用参数；`observe()` 必须调用当前构建产物。不要提交一份会随实现漂移的 projected-output 快照。理由：评审要测的是当前产物的可理解性，快照一旦随实现漂移，测的就是快照不是产物。
2. **盲 prompt 与隐藏 rubric 分离。** `prompt.md` 只能含问题和 `{{EVAL_OBSERVATIONS}}`；答案键、预期 next action、intentional design 只在 `rubric.md`。理由：判定线索泄漏进 prompt 会把评审退化成指令跟随（forward-assertion 污染），作废「fresh model 能否自己理解」这一证据价值。
3. **一次物化，多次独立评审。** 同一批运行共享完全相同的 task，避免把 fixture 波动误判成模型分歧；每次调用新的 headless 进程和隔离的临时 `DSH_HOME`，但暂存所选 profile 的配置与依赖链接。理由：reviewer 输出非确定性，单轮是弱证据；输入 byte-identical 才能把轮间分歧归因于模型而非素材。
4. **主动标准化非语义噪声。** 临时绝对路径、时间戳等应在 plugin 的 observation projection 中替换或移除，同时保留真实字段名与语义。理由：噪声差异会被 reviewer 当成语义信号，制造假分歧。
5. **显式登记 intentional design。** reviewer 提出的 red flag 只有不在该清单中时才是新发现，避免反复争论已接受取舍。理由：没有台账，已接受的取舍会在每轮评审里被重新争论，评审永不收敛——台账同时是 rubric 的人审校准面。
6. **生成物不做 SSOT。** `.runs/` 只用于当次人工审阅，gitignore 使用无路径前缀的 `.runs/`，覆盖任意深度。理由：review 判定是证据不是档案——非确定性被测者的轮次产物当次有效，跨轮对比走 `--report` JSON 与实验面带戳目录。

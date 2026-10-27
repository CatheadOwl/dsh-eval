# @catheadowl/dsh-eval

[English](README.md) | 中文

**面向插件作者的 dsh-native（dsh = DeepSeek 的 deepseek-harness agent CLI）agent 评测层**：behavior case 跑真实 headless dsh trace，review experiment 测 fresh model 能否理解插件输出。

它评测的是**装配后的 agent harness**（插件 + profile + patch + 工具注册表在真实 dsh headless 里接成的那张图），不是孤立函数；判定走 dsh 原生的 session trace 投影与 matcher（契约断言），不是 metric 分数。它不是通用 agent eval 平台（无 dashboard / dataset hosting / metric catalog，也不做 benchmark 排名），也不是 DeepEval / OpenAI Evals 的替代品——那些项目证明了这个问题空间成立，本包选择 dsh-native 的垂直解法。按部署形态说：eval 框架把模型调用内嵌在 harness 里；任务制品（SWE-bench 那一形态）发布任务 + fixture + verifier，由运行方自己供 agent。本包组合两者——mock case 是免凭证制品，由确定性 trace verifier 判定；real case 把装配后的 harness 本身（含 profile 提供的模型）置于契约断言之下；comprehension review 把空白环境 reviewer——只看得到插件物化输出、别无他物的模型——当测量仪器派往插件的输出面，而不是被测对象。

> 文档以中文为主；深度契约在 [docs/](docs/README.md)（matchers / 边界契约 / review / 报告结构 / 宿主接线 / 已知问题）。

## 为什么需要它

| 类型 | 问题 | 粒度 | 判定 | 执行 |
|---|---|---|---|---|
| 单元/shape test | 确定性字段和值是否正确 | component | 自动 | plugin 自己的 `node:test` |
| behavior real | 自然语言意图是否选到正确工具 | trajectory | trace matcher | dsh + 真实模型 |
| behavior mock | 工具管线与写入 round-trip 是否稳定 | trajectory + 终态 | trace matcher + workspace inspect | dsh + 脚本化 mock LLM |
| comprehension review | 一个 fresh model 能否从输出理解含义和下一步 | rubric 为主判 | 人工对照 rubric，多次收敛 | 抽象 review experiment + 可替换 executor |

dsh 插件的正确性来自「装配出的图是否真的把工具、steer、prompt、gate 接到一起」——这类问题插件自己的单测只能覆盖一部分；而「输出能否被理解」根本不是字符串回归。本包把这两层从手动试跑变成可复跑证据。

```text
plugin-owned experiment             shared framework
fixtures + prompt + rubric + observe ──► experiment/review.mjs
                                               │ task
                                               ▼
                                        adapters/dsh/review.mjs ──► dsh headless

behavior *.eval.mjs ───────────────────► dsh behavior runner (trace + mock)
```

- `src/experiment/` 是模型与 runtime 无关的试验设计层：blind review、实时观测、多次 reviewer 字节一致证据。它不 import dsh。
- `src/adapters/dsh/` 是落地层：把抽象任务交给隔离的 dsh headless。
- 你的 `eval/` 只保留领域 fixture、projection/observe、prompt、rubric 与 case，不复制 runner。

## Install

```bash
npm i -D @deepseek-ai/dsh @catheadowl/dsh-eval
```

用 **npm** 安装、宿主同树共装——这是已验证路径。其他包管理器与 store 布局（如 pnpm 虚拟 store）可能让 `dsh-llm` peer 无可解析位置；pnpm workspace 项目请给 eval 单开一个 npm 管的目录（自带 `package.json`），不要装进 workspace——拓扑注记见 [docs/host-wiring/README.md](docs/host-wiring/README.md)。把 `@deepseek-ai/dsh` 钉在与你的 profile 所跑宿主相同的版本——eval 驱动的是本安装树的二进制，驱动宿主与生产宿主的代际错位会静默给出假判定。一切从被测包根跑起（`eval/` 所在处）。Node `^22.19 || >=24`。

**Requirements**（接线细节与失败自诊断见 [docs/host-wiring/README.md](docs/host-wiring/README.md)）：

- dsh 宿主作为 devDependency（`@deepseek-ai/dsh`）——其依赖树自带同代 `dsh-llm`，peer **零手工接线**；已构建检出（`apps/cli/lib/bin.js`，经 `--repo` 钉定）可作为替代宿主来源，非必需；
- 被测插件已装进某个 dsh profile；
- 唯一仍需手工接 peer 的形态：裸装本包且安装树内没有宿主（此时 npm 会自动装到不兼容的古董 `latest` `@deepseek-ai/dsh-llm`——见 host-wiring 文档）。

## Quickstart

`<plugin>/eval/behavior/mock/smoke.eval.mjs`：

```js
import { toolCalled, toolCallStep, textStep } from '@catheadowl/dsh-eval'

export default {
  id: 'my-first-case',
  mode: 'mock',                    // case 缺省 mode 为 'real'，mock 必须显式声明
  task: '把 guide.md 重命名为 intro.md',
  async prepare(workspace) { /* 可选：播种 fixture 文件 */ },
  script: { steps: [toolCallStep('md_rename', { oldPath: 'guide.md', newPath: 'intro.md' }), textStep('done')] },
  expect: [toolCalled('md_rename')],
}
```

被测插件先一次性装进 profile——`dsh plugin add` 的写入面转发 **pnpm**，须在 PATH（`corepack enable pnpm` 或 `npm i -g pnpm`）——再运行；两个 CLI 是本地 bin，经 `npx` 调用：

```bash
npx dsh plugin --profile headless add <插件目录 | tgz>
npx dsh-eval run --profile headless --mode mock eval/behavior/mock
npx dsh-review --dry-run eval/comprehension     # review 层的免模型预演
# → PASS my-first-case
#   1 selected, 1 passed, 0 failed, 0 skipped
```

`--profile headless` 是零 setup 默认——自带模板在隔离 home 首次使用时自动物化。传入的 profile 须为 headless 形 app：case 的 task 以位置参数抵达，web 形 app 会拒绝运行。包根放一份 `dsh-eval.config.mjs` 可替代显式 flag（见下节「统一配置」）。real（`mode: 'real'`）面的完整示例见 [docs/intent-cases.md](docs/intent-cases.md)；real 运行需 env 供 provider key（见 [docs/host-wiring/credentials.md](docs/host-wiring/credentials.md)）。

真实运行用 `dsh-eval run --profile <p> <case 路径>`（CLI 从安装树解析；`--repo <harness 检出>` 可钉定已构建检出）；全部 flags（`--mode/--keep-artifacts/--fail-on-skip/--format/--report`）见 [docs/report.md](docs/report.md)。real case 无凭证时 auto-skip（dsh 自己解析凭证），mock 与 dry-run 不需要任何凭证。real run 用的模型由所选 profile 决定（**不是**交互会话当前选的那个）——来源链、查证方法与钉版做法见 [docs/host-wiring/model-selection.md](docs/host-wiring/model-selection.md)。

## 规范目录

```text
<plugin>/eval/
  .gitignore                 # .runs/（无路径前缀）
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

## 统一配置 dsh-eval.config.mjs

消费者包根放一份，两个 CLI 从工作目录向上查找，flags 永远覆盖 config：

```js
export default {
  profile: 'headless',              // dsh profile
  mode: 'mock',                     // behavior CLI 的 --mode 默认（review 无此项）
  failOnSkip: false,                // behavior CI 门禁默认
  report: 'eval-report.json',       // --report 默认（锚定 config 目录）
  disableRows: ['gates'],           // case 默认禁用的插件行；case 级声明覆盖
                                     // （显式 [] = 全启用，gate 交互 case 用）
}
```

未知 key 直接报错（拼写错误不静默退化）。`disableRows` 的语义与 turn-close 门禁边界契约见 [docs/disablerows.md](docs/disablerows.md)。

## Docs

| 文档 | 主题 |
|---|---|
| [host-wiring](docs/host-wiring/README.md) | 安装与宿主接线的主题索引：peer 接线（古董 peer 坑只在裸装无宿主形态）、CLI 定位链、宿主契约断言、模型选择、凭证、spawn 要求 |
| [concepts](docs/concepts.md) | 主流 agent eval 概念对照：dataset / metric / LLM-as-judge / trajectory / CI 如何映射到 case / matcher / review（behavior 即 unittest 语义，判断冻结于写作时） |
| [host-machinery](docs/host-machinery.md) | 与宿主自带源码机台（test-support 组、快照/e2e/bench 轨）的关系与场景选型表：给定测试场景该用哪个机台 |
| [review](docs/review.md) | comprehension review：实验定义、空白环境 reviewer、产物、六条评审规则、机器 judge 第一道（`--judge`） |
| [matchers](docs/matchers.md) | trace matcher 与 mock helper 全集（工具面 / 文本面 / 模型可见面） |
| [disablerows](docs/disablerows.md) | `disableRows` 与 turn-close 门禁边界契约 |
| [rowconfig](docs/rowconfig.md) | `rowConfig` 行 config 覆写契约（整段替换、重述所需键） |
| [environment](docs/environment.md) | 实验环境纪律：认知并控制运行环境——staging 覆盖边界与漏入通道、混杂两形态（假红/假绿）、行级钉面默认 + case 级恢复的方向原则 |
| [cross-turn](docs/cross-turn.md) | `followups` 跨轮异步驱动契约（driver 行换装、子 agent settle 等待、mock 单 cursor 编排、有界重派断言） |
| [experiments](docs/experiments.md) | 行为实验契约：臂 = case 字段覆写 × 重复 × 守卫 × 聚合（`defineBehaviorExperiment`、臂覆写深合并、INVALID 纪律、预注册 decisionRule） |
| [intent-cases](docs/intent-cases.md) | real 意图 case 规约：何时写、断言面、守卫、CI 语义 |
| [report](docs/report.md) | 机器可读报告（`--format json` / `--report`）结构 |
| [known-issues](docs/known-issues.md) | 已知问题与规避（如 staged home 的 REQUEST_EXTENSION） |
| [runner-api](docs/runner-api.md) | 程序化 runner API：`runEvalCase` options 契约、EvalRunResult 字段、跨档取 `cliPath` |
| [experimental](docs/experimental.md) | `experimental` 子路径符号清单（逃生面，无兼容承诺） |

## 运行保障

runner 用 `try/finally` 保证临时目录与链接在任何路径（`prepare` 抛错、mock 校验失败、spawn 错误）都被清理，不污染真实 profile store。behavior 与 review CLI 共享目录扫描（跳过 `.runs` 与 `node_modules`）；behavior CLI 在加载期做 case shape 校验与跨文件重复 id 检测，尽早失败。

License: MIT。框架自身的测试与发布自检由仓库 CI 承接，不随包发布。发布历史：[CHANGELOG.md](CHANGELOG.md)。

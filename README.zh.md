---
description: '@catheadowl/dsh-eval 中文主页——dsh-native agent 评测层：behavior case 跑真实 headless dsh trace，review experiment 测 fresh model 能否理解插件输出'
---

# @catheadowl/dsh-eval

[English](README.md) | 中文

**面向插件作者的 dsh-native agent 评测层**：behavior case 跑真实 headless dsh trace，review experiment 测 fresh model 能否理解插件输出。

它评测的是**装配后的 agent harness**（插件 + profile + patch + 工具注册表在真实 dsh headless 里接成的那张图），不是孤立函数；判定走 dsh 原生的 session trace 投影与 matcher（契约断言），不是 metric 分数。它不是通用 agent eval 平台（无 dashboard / dataset hosting / metric catalog，也不做 benchmark 排名），也不是 DeepEval / OpenAI Evals 的替代品——那些项目证明了这个问题空间成立，本包选择 dsh-native 的垂直解法。

> 文档以中文为主；深度契约在 [docs/](docs/README.md)（matchers / 边界契约 / review / 报告结构 / 宿主接线 / 已知问题）。

## 为什么需要它

| 类型 | 问题 | 判定 | 执行 |
|---|---|---|---|
| 单元/shape test | 确定性字段和值是否正确 | 自动 | plugin 自己的 `node:test` |
| behavior real | 自然语言意图是否选到正确工具 | trace matcher | dsh + 真实模型 |
| behavior mock | 工具管线与写入 round-trip 是否稳定 | trace matcher + workspace inspect | dsh + 脚本化 mock LLM |
| comprehension review | 一个 fresh model 能否从输出理解含义和下一步 | 人工对照 rubric，多次收敛 | 抽象 review experiment + 可替换 executor |

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
npm i -D @catheadowl/dsh-eval
```

**Requirements**（接线细节与失败自诊断见 [docs/host-wiring.md](docs/host-wiring.md)）：

- 一个已构建的 deepseek-harness 检出（`apps/cli/lib/bin.js`）；
- 被测插件已装进某个 dsh profile；
- peer 依赖 `@deepseek-ai/dsh-llm` 需手工接线（npm 会自动装到不兼容的古董版，须替换为指向宿主检出的链接）。

## Quickstart

`<plugin>/eval/behavior/mock/smoke.eval.mjs`：

```js
import { firstTool, toolCalled, toolCallStep, textStep } from '@catheadowl/dsh-eval'

export default {
  id: 'my-first-case',
  mode: 'mock',
  task: '把 guide.md 重命名为 intro.md',
  async prepare(workspace) { /* 播种 fixture 文件 */ },
  script: { steps: [toolCallStep('md_rename', { oldPath: 'guide.md', newPath: 'intro.md' }), textStep('done')] },
  expect: [toolCalled('md_rename')],
}
```

```bash
dsh-eval run --mode mock eval/behavior/mock
dsh-review --dry-run eval/comprehension     # review 层的免模型预演
```

命令需要知道用哪个 dsh profile：显式传 `--profile <name>`，或放一份 `dsh-eval.config.mjs` 到包根（见下节「统一配置」）。

真实运行用 `dsh-eval run --profile <p> --repo <harness 检出> <case 路径>`；全部 flags（`--mode/--keep-artifacts/--fail-on-skip/--format/--report`）见 [docs/report.md](docs/report.md)。real case 无凭证时 auto-skip（dsh 自己解析凭证），mock 与 dry-run 不需要任何凭证。

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
  repo: '../../deepseek-harness',   // 相对路径锚定 config 文件所在目录
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
| [host-wiring](docs/host-wiring.md) | peer 接线（含 npm 古董 peer 坑）、构建 CLI、profile、凭证、spawn 要求 |
| [review](docs/review.md) | comprehension review：实验定义、sterile profile、产物、六条评审规则 |
| [matchers](docs/matchers.md) | trace matcher 与 mock helper 全集（工具面 / 文本面 / 模型可见面） |
| [disablerows](docs/disablerows.md) | `disableRows` 与 turn-close 门禁边界契约 |
| [rowconfig](docs/rowconfig.md) | `rowConfig` 行 config 覆写契约（整段替换、重述所需键） |
| [intent-cases](docs/intent-cases.md) | real 意图 case 规约：何时写、断言面、守卫、CI 语义 |
| [report](docs/report.md) | 机器可读报告（`--format json` / `--report`）结构 |
| [known-issues](docs/known-issues.md) | 已知问题与规避（如 staged home 的 REQUEST_EXTENSION） |

## 运行保障

runner 用 `try/finally` 保证临时目录与链接在任何路径（`prepare` 抛错、mock 校验失败、spawn 错误）都被清理，不污染真实 profile store。behavior 与 review CLI 共享目录扫描（跳过 `.runs` 与 `node_modules`）；behavior CLI 在加载期做 case shape 校验与跨文件重复 id 检测，尽早失败。

License: MIT。框架自身的测试与发布自检由仓库 CI 承接，不随包发布。

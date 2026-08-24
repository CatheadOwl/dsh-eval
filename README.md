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

当前迁移实例：[`any_routes/eval/`](../any_routes/eval/README.md) 与 [`coggit/eval/`](../coggit/eval/README.md)。

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
  --profile <headless-profile> \
  --repo ../../deepseek-harness \
  [--runs 5] [--timeout 300000] \
  <experiment file or directory>
```

真实运行会把 reviewer 置为**无工具**：适配器生成一份 `--patch` 覆盖层，禁用所有宿主模型可见工具（`tool-fs`、`tool-fs-search`、shell、web、subagent 等），并把 cwd 指向空临时目录——reviewer 只能从物化的观测文本推理，无法调工具查真实目录（盲评泄露 workspace 的问题）。扩展自行注册的工具（如 `coggit_*`）仍保留，但它们只查会话 workspace 的 CogGit 状态、不读文件树。

产物落在 review 文件旁的 `.runs/<experiment id>/`：

- `observations.md`：本次实时物化的可见证据；
- `task.txt`：实际发给每位 reviewer 的完整任务；
- `run-N.txt` / stderr / error：各次独立运行；
- `run.json`：experiment、rubric、adapter、profile 与 run 数。

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
  expect: [firstTool('x'), toolCalled('x')],
}
```

matcher：`toolCalled`、`toolNotCalled`、`firstTool`、`toolSequence`、`toolCallArgs`、`toolResultFor`、`finalTextIncludes`、`finalTextMatches`、`systemPromptIncludes`（组装后的 system prompt 含指定子串）、`toolMounted`（工具出现在某个 request/header 的挂载列表）。mock helper：`toolCallStep`、`textStep`。

```bash
node bin/dsh-eval.mjs run --profile <profile> --repo <deepseek-harness> \
  [--mode real|mock|all] [--keep-artifacts] <case file or directory...>
```

每条 behavior case 在隔离的临时 `DSH_HOME` 与 workspace 中启动 dsh，通过 `--patch` 把 session JSONL 定向到本次 run，随后解析 `tool/call`、`tool/result` 与最终文本。mock 会插入脚本化 `eval-mock` adapter，但工具执行仍走真实 Cordis/tool 管线。失败产物位于 case 旁 `.runs/<case id>/`。

## 自测与宿主证据

```bash
pnpm test
```

宿主 seam 的源溯登记在 [`explorer/eval-seams/`](../../explorer/eval-seams/summary.md)。dsh runner 依赖已构建的 `deepseek-harness/apps/cli/lib/bin.js`；real 层需要 `DEEPSEEK_API_KEY` 或 `$DSH_HOME/.credentials.yaml`，mock 与 review dry-run 不需要。

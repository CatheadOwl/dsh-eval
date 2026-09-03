# Comprehension review

理解评审回答 behavior matcher 无法回答的问题：**一个 fresh model 能否从插件
输出理解含义和下一步**。「缺少应有提示」「字段容易误读」是设计缺口，不是
固定字符串回归——刻意不用 trace matcher 自动化；反过来，行为层不负责评价
自由文本设计。

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

抽象层公开 `defineReviewExperiment`、`materializeReviewExperiment`、
`executeReviewExperiment` 与标准 observation renderer。自定义 executor 只需
实现 `(task, context) => result`；接入其他 agent runtime 不需要改试验定义。

## CLI

```bash
# dry-run 不要求 profile 或已构建 dsh CLI
dsh-review --dry-run <experiment file or directory>

dsh-review \
  --profile <sterile-profile> \
  --repo <deepseek-harness checkout> \
  [--runs 5] [--timeout 300000] \
  <experiment file or directory>
```

`--profile`/`--repo` 可来自 `dsh-eval.config.mjs`（见 README），flags 覆盖
config。

## sterile profile 与工具边界

真实运行使用**专用 sterile profile**（默认 `headless`，即宿主模板
`dsh-base` + `dsh-headless`，无树外插件）：适配器生成一份 `--patch` 覆盖层
禁用所有宿主模型可见工具（`tool-fs`、`tool-fs-search`、shell、web、subagent
等），并把 cwd 指向空临时目录——reviewer 只能从物化的观测文本推理。运行后
解析 session trace 的 `request/header` 事件做**工具边界校验**：发现任何非
预期工具即视为 adapter failure（证据写入
`.runs/<id>/run-N.tool-boundary-evidence.json`）。

> **运维前提**：profile staging 在真实 home 已有同名 profile 时**原样复制**
> （含已安装插件与 patch 层）。若本机 `headless` profile 装过树外插件，暂存
> 后的 profile **不是无菌的**——工具边界校验会当场 fail-loud（这是设计的
> 正确行为）。保持无菌：删掉本机 `headless` profile 让 boot 重建出厂模板，
> 或指定一个确认无插件的 profile。

## 产物

落在 review 文件旁的 `.runs/<experiment id>/`：

- `observations.md`：本次实时物化的可见证据；
- `task.txt`：实际发给每位 reviewer 的完整任务；
- `run-N.txt` / stderr / error：各次独立运行；
- `run.json`：experiment、rubric、adapter、profile 与 run 数；
- `review-report.md`：判读报告骨架——机器字段自动填（experiment/adapter/
  profile/runs、observations 指纹、rubric 位置、每轮 reviewer 原文），三个
  **人工判读栏目**留白待填：intentional design 命中项、新 red flag、下一步
  （改输出 / 改 rubric / 改 behavior case / 不处理）。刻意不做自动评分——
  review 层的价值在人工判断，报告只把判断物化成可归档、可对比的工程证据
  （dry-run 也会生成，runs 记 0）。

## 从早期 eval 固化下来的六条规则

1. **冻结输入，实时投影输出。** fixture 保存 raw SDK result、合成知识库或
   调用参数；`observe()` 必须调用当前构建产物。不要提交一份会随实现漂移的
   projected-output 快照。
2. **盲 prompt 与隐藏 rubric 分离。** `prompt.md` 只能含问题和
   `{{EVAL_OBSERVATIONS}}`；答案键、预期 next action、intentional design 只在
   `rubric.md`。
3. **一次物化，多次独立评审。** 同一批运行共享完全相同的 task，避免把
   fixture 波动误判成模型分歧；每次调用新的 headless 进程和隔离的临时
   `DSH_HOME`，但暂存所选 profile 的配置与依赖链接。
4. **主动标准化非语义噪声。** 临时绝对路径、时间戳等应在 plugin 的
   observation projection 中替换或移除，同时保留真实字段名与语义。
5. **显式登记 intentional design。** reviewer 提出的 red flag 只有不在该清单
   中时才是新发现，避免反复争论已接受取舍。
6. **生成物不做 SSOT。** `.runs/` 只用于当次人工审阅，gitignore 使用无路径
   前缀的 `.runs/`，覆盖任意深度。

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

抽象层公开 `defineReviewExperiment`（稳定根入口）。实验执行与渲染原语——`materializeReviewExperiment`、`executeReviewExperiment`、标准 observation renderer（`renderObservationSections`；prompt 里的观测占位符常量是 `OBSERVATIONS_PLACEHOLDER`，必须恰好出现一次）——在 `@catheadowl/dsh-eval/experimental` 逃生面（见 [experimental.md](experimental.md)，无兼容承诺）。自定义 executor 只需实现 `(task, context) => result`；接入其他 agent runtime 不需要改试验定义。

## CLI

```bash
# dry-run 不要求 profile 或已构建 dsh CLI
dsh-review --dry-run <experiment file or directory>

dsh-review \
  --profile <profile> \
  --repo <deepseek-harness checkout> \
  [--runs 5] [--timeout 300000] [--keep-plugin-rows] \
  <experiment file or directory>
```

`--profile`/`--repo` 可来自 `dsh-eval.config.mjs`（见 README），flags 覆盖 config。

## 空白环境（默认）与工具边界

真实运行的 reviewer 会话默认在**空白环境**启动：适配器先照常暂存所选 profile，再枚举它组合出的**全部树外插件行**（`package.json` 的 `dsh.profile.bundles` 中非 `@deepseek-ai/*` 的 bundle 各自 patch 文件里的行，加上 profile 自有 `cordis.patch.yml` 的行），在 `--patch` overlay 里逐行禁用——宿主 profile 装了什么 gates/插件都与 reviewer 无关，可复现性不再依赖「本机 profile 恰好干净」。白名单保留 reviewer 起不来就无测可言的接线行（`agent-default-model`、`session-title-llm`、`system-prompt`、`session-persistence-jsonl`）；宿主模板工具行（`tool-fs`、shell、web、subagent 等）由静态清单继续禁用，cwd 指向空临时目录——reviewer 只能从物化的观测文本推理。运行后解析 session trace 的 `request/header` 事件做**工具边界校验**：发现任何非预期工具即视为 adapter failure（证据写入 `.runs/<id>/run-N.tool-boundary-evidence.json`）。

**刻意复用宿主插件面**（例如要评审某插件自己的 gate 行为）：加 `--keep-plugin-rows`——跳过树外行枚举，仅保留静态工具禁用，宿主 gates 恢复运行。

> 注意：无 `id` 的组合条目对 id 定位的禁用天然不可见（宿主 loader 语义），本包的树外 bundle 生态均为带 id 行形态；发现无 id 树外行时以工具边界校验 fail-loud 兜底。白名单是**按行名**无条件保留——若某树外 bundle 刻意以白名单名（如 `system-prompt`）insert 自己的行，该行不会被禁（威胁模型是本机自己的 profile，非对抗面）；此类泄漏同样由工具边界校验兜底。

## 产物

落在 review 文件旁的 `.runs/<experiment id>/`：

- `observations.md`：本次实时物化的可见证据；
- `task.txt`：实际发给每位 reviewer 的完整任务；
- `run-N.txt` / stderr / error：各次独立运行；
- `run.json`：experiment、rubric、adapter、profile 与 run 数；
- `review-report.md`：判读报告骨架——机器字段自动填（experiment/adapter/ profile/runs、observations 指纹、rubric 位置、每轮 reviewer 原文），三个 **人工判读栏目**留白待填：intentional design 命中项、新 red flag、下一步（改输出 / 改 rubric / 改 behavior case / 不处理）。刻意不做自动评分——review 层的价值在人工判断，报告只把判断物化成可归档、可对比的工程证据（dry-run 也会生成，runs 记 0）。

## 六条评审规则

1. **冻结输入，实时投影输出。** fixture 保存 raw SDK result、合成知识库或调用参数；`observe()` 必须调用当前构建产物。不要提交一份会随实现漂移的 projected-output 快照。
2. **盲 prompt 与隐藏 rubric 分离。** `prompt.md` 只能含问题和 `{{EVAL_OBSERVATIONS}}`；答案键、预期 next action、intentional design 只在 `rubric.md`。
3. **一次物化，多次独立评审。** 同一批运行共享完全相同的 task，避免把 fixture 波动误判成模型分歧；每次调用新的 headless 进程和隔离的临时 `DSH_HOME`，但暂存所选 profile 的配置与依赖链接。
4. **主动标准化非语义噪声。** 临时绝对路径、时间戳等应在 plugin 的 observation projection 中替换或移除，同时保留真实字段名与语义。
5. **显式登记 intentional design。** reviewer 提出的 red flag 只有不在该清单中时才是新发现，避免反复争论已接受取舍。
6. **生成物不做 SSOT。** `.runs/` 只用于当次人工审阅，gitignore 使用无路径前缀的 `.runs/`，覆盖任意深度。

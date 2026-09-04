---
description: experimental 子路径符号清单——机制原语（沙箱/overlay/trace、review 执行器、CLI 解析链）的逃生面；无兼容承诺，随 minor 变更
---

# experimental 子路径（逃生面）

<!-- experimental-tier-warning -->

> **⚠️ 无兼容承诺**：本入口的全部符号可在任意 minor 版本变更、移动或移除，不另行弃用周期。case 作者请使用包根入口（断言 DSL、`textStep` / `toolCallStep`、`defineReviewExperiment`、`runEvalCase`）；只有自建执行面 / ad-hoc 诊断脚本才应 import 本入口，并自行承担跟进成本。

```js
import { resolveDshCliChain } from '@catheadowl/dsh-eval/experimental'
```

## 符号清单

| 符号 | 用途 |
|---|---|
| `resolveDshCliChain` | 现代三段式 dsh CLI 解析链（`--repo` 旗标 → 解析层 node_modules → config `repo`），返回 `{ cli, repo, source }`；解析失败同步抛错（指引见 [host-wiring.md](host-wiring.md)） |
| `stageProfileStore` | 把真实 profile store junction 感知地暂存进沙箱 home（沙箱机制） |
| `buildOverlayYaml` | 由片段拼装 dsh overlay YAML（整段发射器） |
| `overlayDisableRows` | 生成 `disabled: true` 的行禁用 overlay 片段 |
| `parseSessionLog` | 解析一条未压缩 JSONL session artifact 为 `{ header, events }` |
| `buildTrace` | 把 session 事件投影为 matcher 使用的 trace 对象 |
| `loadTraceDir` | 从 run 目录装载并解析 trace（无日志时返回 `undefined`） |
| `executeReviewExperiment` | 用给定 executor 执行抽象 review 实验 |
| `materializeReviewExperiment` | 把实验定义物化为产物目录 |
| `renderObservationSections` | 标准 observation renderer（自定义 executor 用） |
| `OBSERVATIONS_PLACEHOLDER` | prompt 中的观测占位符常量（必须恰好出现一次） |
| `createDshHeadlessReviewExecutor` | 构造 dsh headless review executor |
| `runDshReviewExperiment` | 端到端跑一个 dsh review 实验 |
| `validateToolBoundary` | 校验 trace 满足 turn-close 工具边界契约 |
| `renderToolBoundaryEvidence` | 渲染边界校验的机器可读证据 |

新公开能力先进本入口；稳定后经明确决策才升入包根入口（升入即接受 semver 义务）。

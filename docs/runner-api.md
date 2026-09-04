---
description: 程序化 runner API——runEvalCase 的 options 契约（SDK 承诺）、EvalRunResult 字段、DSH_EVAL_KEEP_TMP 逃生、与 experimental 档 resolveDshCliChain 的跨档关系
---

# 程序化 runner API

`runEvalCase` 从包根导入，是 SDK 稳定面的一部分（semver 承诺）：

```js
import { runEvalCase } from '@catheadowl/dsh-eval'

const result = await runEvalCase(evalCase, { profile: 'headless', cliPath, mode: 'real' })
```

## options（SDK 承诺）

| 键 | 类型 | 语义 |
|---|---|---|
| `profile` | `string` | 必填。承载被测插件的 dsh profile（沙箱会暂存其 store，不污染真实 home）。 |
| `cliPath` | `string` | 编译好的 dsh CLI 入口（`apps/cli/lib/bin.js`）绝对路径；优先于 `dshRepoDir`。程序化取值见下节。 |
| `mode` | `'real' \| 'mock'` | 覆写 case 自带的 mode；mock 需 `script.steps`。 |
| `artifactsDir` | `string` | 提供则把 stdout/stderr/trace/session 日志拷贝到该目录（自动创建）。 |
| `dshRepoDir` | `string` | **已弃用**：宿主 checkout 目录（从中拼出 CLI 路径）。下个 minor 删除——迁移到 `cliPath`。 |

## `cliPath` 从哪来：跨档关系（读我）

稳定档不提供 CLI 定位器；程序化解析走 experimental 档的 `resolveDshCliChain`（`import '@catheadowl/dsh-eval/experimental'`，见 [experimental.md](experimental.md)）。**该档无兼容承诺**：若你的脚本不能接受随 minor 跟进，可自行传入 `cliPath`（如来自你自己的部署清单），`runEvalCase` 不假设来源。

## EvalRunResult 字段

| 字段 | 语义 |
|---|---|
| `caseId` / `mode` / `task` | 回显 case 标识。 |
| `exitCode` | headless CLI 退出码（0 = turn 完成）。 |
| `timedOut` | 是否超时被杀。 |
| `stdout` / `stderr` | CLI 原始输出（stdout 含最终 assistant 文本与启动 chatter）。 |
| `trace` | session 事件投影（形状见 [matchers.md](matchers.md) 的 trace 形状表）；无日志时为 `undefined`。 |
| `sessionLogs` | 清理前的原始 session artifact 文本数组。 |
| `inspectError` | case 的 `inspect` 抛错时的错误文本。 |
| `runDir` | 本次运行的沙箱目录——**默认清理**；设环境变量 `DSH_EVAL_KEEP_TMP=1` 保留（失败诊断用）。 |

清理是全路径 `try/finally`：`prepare` 抛错、mock 校验失败、spawn 失败都会清理，真实 profile store 永不被污染。

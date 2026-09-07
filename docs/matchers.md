---
description: trace matcher 与 mock helper 全集——工具面/文本面/输入面/派发面断言语义（toolCalled 到 subagentCompleted）与 toolCallStep/textStep 脚本构件
---

# Trace matchers 与 mock helpers

全部从包根导入：`import { toolCalled, … } from '@catheadowl/dsh-eval'`。

断言对象是 dsh session 事件投影（`EvalTrace`），不只是「模型产出」：`requestHeaders` 投影模型被挂载的工具与 system prompt（输入面），`userMessages` 投影 user-role 的模型可见输入面（任务 prompt、插件 steer、注入上下文）——这让 mock 能断言插件的**驱动级 steer**，而不只断工具选择或最终文本。

## EvalTrace 形状（谓词与 `result.trace` 共用）

| 字段 | 形状 |
|---|---|
| `toolCalls` | `{ seq, turn, step, callId, name, arguments, parsedArguments }[]`（`arguments` 原文，`parsedArguments` 已 JSON 解析） |
| `toolResults` | `{ seq, turn, step, callId, text, error?, isError? }[]`（与 `toolCalls` 按 `callId` 配对） |
| `assistantTexts` | `string[]` 非空组装 assistant 文本，按日志序 |
| `finalText` | 最后一个组装 assistant 文本（无则 `''`） |
| `userMessages` | `{ seq, source, text }[]`（`source` 原样透传：任务 prompt `{ kind: 'user' }`，插件 steer `{ kind: 'plugin', plugin }`） |
| `requestHeaders` | `{ seq, reason, system, toolNames }[]`（组装后 system prompt + 挂载工具名） |
| `subagentChildren` | `{ sessionId, parentSession, delegationDepth, label, mode, provider, assistantTexts, finalText }[]`——每个子 agent 独立 session 日志一条；身份（label/mode/provider）取子日志首条 version-3 的 `subagent/descriptor` 事件（镜像宿主 `foldSubagentDescriptor` 的首条权威语义），`finalText` 是子会话自己的最后一条非空 assistant 文本（无则 `''` = 派发了但没答） |
| `sessions` / `sessionId` | 原始解析结果 `{ header, events }[]` 与主 session id |

`runEvalCase` 返回的 `result.trace` 即此形状（无 session 日志时为 `undefined`；字段语义见 [runner-api.md](runner-api.md)）。

## 工具面

- `toolCalled(name)` / `toolNotCalled(name)`：工具被/未被调用（字符串或 RegExp）；
- `firstTool(name)`：首个工具调用是它（慎用——探索在前合法，意图 case 通常用 `toolCalled`）；
- `toolSequence(names)`：按序子序列；
- `toolCallArgs(name, subset | predicate)`：参数子集匹配（或谓词，收 parsed 与 raw）；
- `toolResultFor(name)`：匹配的调用有结果配对；
- `toolResultIsError(name)` / `toolResultSucceeded(name)`：结果 `isError === true` / 不为 true；
- `toolResultTextIncludes(name, substring)`：结果文本含子串。

## 文本面

- `finalTextIncludes(substring)` / `finalTextMatches(re)`：最后一个非空 assistant 文本（mock 层断言的是脚本终步的确定性文本）；
- `assistantTextIncludes(substring)`：**任一** assistant 文本含子串——turn-close 门禁 splice 反馈步骤、`finalText*` 被截走时的 case 级出口。

## 模型可见面（输入侧）

- `systemPromptIncludes(substring)`：组装后的 system prompt 含子串；
- `toolMounted(name)`：工具出现在某个 request/header 的挂载列表；
- `userMessageTextIncludes(source, substring)` / `userMessageTextExcludes(source, substring)`：按 `source` 过滤的 `user/message` 文本含/不含子串。`source` 用字符串/RegExp 匹配 `plugin` 名（如 steer 生产方），或谓词取整个 `source`——steer 在持久化日志里没有专名事件（`agent.steer()` 落为 `user/message`），区分靠 `source`（插件 steer 为 `{ kind: 'plugin', plugin: '<id>' }`，任务 prompt 为 `{ kind: 'user' }`）。

## 派发面（子 agent）

主 session 日志不含派发事件（宿主不向父 session 写），但子 agent 的独立 session 日志与主日志同 persistence root，随 run 一并被收集——派发面投影即来自这些子日志：

- `subagentDispatched(label)`：至少一个子 agent 以匹配的 label 派发。`label` 用字符串/RegExp 匹配子会话的 `subagent/descriptor` label（如 `gates:fix:<gate>`、前缀 `/^gates:fix:/`），或谓词取整个子记录（可按 `mode`/`provider`/`delegationDepth` 匹配）；
- `subagentCompleted(label)`：匹配的子 agent 产出了答案——其自身日志含至少一条非空 assistant 文本（不区分中止/正常收束：日志层无 subagent 完成事件，产出过文本即算）。只派发未应答（子日志存在但无产出）不通过。

边界：子会话产物（独立 JSONL）经 `subagentChildren` 记录进入断言面（身份 + 子自身文本）；子会话内部的工具调用**不**并入主投影的 `toolCalls`/`toolResults`（那属于主会话行为面），需要时经 `sessions` 原始日志自行投影。

## Mock script helpers

- `toolCallStep(name, args)`：一步「模型调工具」，结束于 tool-calls；
- `textStep(text)`：一步「模型说话」，结束于 stop（turn 收束）。

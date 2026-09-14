---
description: trace matcher 与 mock helper 全集——工具面/文本面/输入面/派发面断言语义（toolCalled 到 subagentCompletedCount）、投影普查（trace.census）与 toolCallStep/textStep 脚本构件
---

# Trace matchers 与 mock helpers

全部从包根导入：`import { toolCalled, … } from '@catheadowl/dsh-eval'`。

断言对象是 dsh session 事件投影（`EvalTrace`），不只是「模型产出」：`requestHeaders` 投影模型被挂载的工具（输入面），`systemMessages` / `systemPrompt` 投影组装后 system prompt（v3 面事件折叠；前 v3 代在 `requestHeaders[].system`），`userMessages` 投影 user-role 的模型可见输入面（任务 prompt、插件 steer、注入上下文）——这让 mock 能断言插件的**驱动级 steer**，而不只断工具选择或最终文本。

## EvalTrace 形状（谓词与 `result.trace` 共用）

| 字段 | 形状 |
|---|---|
| `toolCalls` | `{ seq, turn, step, callId, name, arguments, parsedArguments }[]`（`arguments` 原文，`parsedArguments` 已 JSON 解析） |
| `toolResults` | `{ seq, turn, step, callId, text, error?, isError? }[]`（与 `toolCalls` 按 `callId` 配对） |
| `assistantTexts` | `string[]` 非空组装 assistant 文本，按日志序 |
| `finalText` | 最后一个组装 assistant 文本（无则 `''`） |
| `userMessages` | `{ seq, source, text }[]`（`source` 原样透传：任务 prompt `{ kind: 'user' }`，插件 steer `{ kind: 'plugin', plugin }`） |
| `requestHeaders` | `{ seq, reason, system, toolNames }[]`（挂载工具名 + system prompt——**system 仅前 v3 代携带**，v3 起该字段恒空串，prompt 移至 `systemMessages`） |
| `systemMessages` / `systemPrompt` | v3 的 system prompt 面：`{ seq, text }[]` 存活 `system/message` 节点（append/replace 面折叠、按面序）+ 有效 prompt（存活节点最后一个非空，无则 `''`）。前 v3 代两者为空——读 `requestHeaders[].system` |
| `subagentChildren` | `{ sessionId, parentSession, delegationDepth, label, mode, provider, assistantTexts, finalText }[]`——每个子 agent 独立 session 日志一条；身份（label/mode/provider）取子日志首条 version-3 的 `subagent/descriptor` 事件（镜像宿主 `foldSubagentDescriptor` 的首条权威语义），`finalText` 是子会话自己的最后一条非空 assistant 文本（无则 `''` = 派发了但没答） |
| `census` | 投影普查（只报数，不判定）：`{ eventTypeCounts, projectionLengths, projectionSkipped: { main, children }, projectionFieldGaps, subagent: { mainLogDescriptorEvents, supportedDescriptors, children } }`。语义见下「投影普查」节；手搓 trace（不经 `buildTrace`）时可为 `undefined` |
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

- `systemPromptIncludes(substring)`：组装后的 system prompt 含子串。**按会话格式代取渠道**：v3 日志读 `system/message` 面事件折叠（`systemPrompt`）；前 v3 日志回退读 `requestHeaders[].system`。两条渠道**都不存在**时响亮失败（渠道空置，不读作「prompt 缺子串」）——守卫因此能区分「没写进 prompt」与「根本看不到 prompt」；
- `toolMounted(name)`：工具出现在某个 request/header 的挂载列表；
- `userMessageTextIncludes(source, substring)` / `userMessageTextExcludes(source, substring)`：按 `source` 过滤的 `user/message` 文本含/不含子串。`source` 用字符串/RegExp 匹配 `plugin` 名（如 steer 生产方），或谓词取整个 `source`——steer 在持久化日志里没有专名事件（`agent.steer()` 落为 `user/message`），区分靠 `source`（插件 steer 为 `{ kind: 'plugin', plugin: '<id>' }`，任务 prompt 为 `{ kind: 'user' }`）。

## 派发面（子 agent）

主 session 日志不含派发事件（宿主不向父 session 写），但子 agent 的独立 session 日志与主日志同 persistence root，随 run 一并被收集——派发面投影即来自这些子日志：

- `subagentDispatched(label)`：至少一个子 agent 以匹配的 label 派发。`label` 用字符串/RegExp 匹配子会话的 `subagent/descriptor` label（如 `gates:fix:<gate>`、前缀 `/^gates:fix:/`），或谓词取整个子记录（可按 `mode`/`provider`/`delegationDepth` 匹配）；
- `subagentCompleted(label)`：匹配的子 agent 产出了答案——其自身日志含至少一条非空 assistant 文本（不区分中止/正常收束：日志层无 subagent 完成事件，产出过文本即算）。只派发未应答（子日志存在但无产出）不通过。
- `subagentDispatchCount(label, expected)`：匹配 label 的派发**总数**恰为 `expected`——有界重派节律断言（「每轮恰一次、不更多」），配合跨轮驱动（[cross-turn.md](cross-turn.md)）。
- `subagentCompletedCount(label, expected)`：匹配 label 且**跑完**（产出非空 assistant 文本）的子 agent 恰为 `expected` 个。`subagentCompleted` 任一跑完即过；本 matcher 钉死每个派发的结局——「已派发 ⇒ 可观测结局」的跨轮 case 里，任一被截断的子 agent 都判负。

边界：子会话产物（独立 JSONL）经 `subagentChildren` 记录进入断言面（身份 + 子自身文本）；子会话内部的工具调用**不**并入主投影的 `toolCalls`/`toolResults`（那属于主会话行为面），需要时经 `sessions` 原始日志自行投影。

## 投影普查（`trace.census`）

宽松投影（tolerant reader）的补救面：宿主事件 payload 演进时 `buildTrace` 不抛错，只把字段填成空值或丢掉整条记录。空投影会让负向断言真空通过——`toolNotCalled`、`userMessageTextExcludes`、以及 `subagentDispatchCount` / `subagentCompletedCount` 的 `expected === 0` 档都判 ok。**普查只报数，不判定**：它让「宿主日志里本来就没有这类事件」与「有事件但投影丢掉了」在报告里可分，是否降级由人判读。

三个信号，对应三种坏法：

| 信号 | 看什么 |
|---|---|
| 主 session 事件（`eventTypeCounts` / `projectionLengths` / `projectionSkipped.main`） | 主日志（`buildTrace` 的投影输入）逐事件类型计数（任何类型，含插件扩展类型）；六个投影的长度；以及**每个投影上「计数 − 长度 > 0」的差额**（`projectionSkipped.main`，按投影字段名）——记录被丢了的档 |
| **字段级缺口**（`projectionFieldGaps`） | 记录**留住了但字段读不到**的事件，按缺什么计数：`toolCallWithoutName` / `toolCallWithoutCallId` / `toolResultWithoutCallId` / `headerWithoutSystem`（**仅前 v3 代**——v3 起 header 无 system 是设计，不计数）/ `headerWithoutToolNames`；外加渠道级 `promptSurfaceAbsent`：有 request 而两条 prompt 渠道都不存在（无 `system/message` 事件且无 header system）——「根本看不到 prompt」的形态。`tool/call`、`tool/result`、`request/header` 是 1:1 投影（计数 − 长度恒为 0），宿主搬字段时只在这里可见。**不计数**：`request/header` 的 `tools` 数组整个缺失（与真空列表投影一致） |
| 子会话（`census.subagent`） | `subagentChildren` 的输入面：`children[]` 逐条给该子日志的 `subagent/descriptor` 事件数、其中 `version === 3` 的条数（`supportedDescriptors`，**数事件不是数子会话**）**以及折叠出的身份**（`label` / `mode` / `provider`）；`projectionSkipped.children` 两个身份计数——`withoutIdentity`（三项全缺）与 `withoutLabel`（`label` 缺，哪怕 mode/provider 有）。`mainLogDescriptorEvents` 是**主日志自己**的 `subagent/descriptor` 事件数（现宿主把 descriptor 写进子日志，这个数通常为 0）。**子日志不是主日志**，`eventTypeCounts` 不统计它们 |

判读要点：

- **差额 ≠ 缺陷**。`assistant/message`、`user/message` 的**空文本消息是设计上整条丢弃**（保护「组装文本」投影语义）；`system/message` 的**被阴影节点是面语义设计丢弃**（replace/compaction 折叠）——这类差额属合法，普查不替你做白名单；
- **两类信号别混**：`projectionSkipped.main` 看「记录被丢了」，`projectionFieldGaps` 看「记录在、字段没了」。后者正是 `toolNotCalled` 最危险的形态——调用记录还在、`name` 为 `undefined`，`nameMatches` 对任何 matcher 都不命中，负向断言照绿；
- **身份缺失型降级**：某子日志 `descriptorEvents > 0` 而 `supportedDescriptors === 0`，即它进了 `subagentChildren` 但身份全空；但**只要 `label` 缺**（`withoutLabel`），按 label 匹配的 `*Count(label, 0)` 就会真空通过——哪怕 `supportedDescriptors` 看起来健康、mode/provider 都在。两个计数分开报就是为了这个档；
- **子会话集合是启发式**：`subagentChildren` 收「header 带 `parentSession`」的日志，而宿主对 fork/resume/seed 日志也写这个字段——它们会以「无身份子记录」出现在普查里。这是集合的性质，不是本次降级（日志层无法复现宿主的 agent 链所有权判定）；
- 只出现在**运行面**：`--format json` 的每条 case 记录（`census` 字段，pass 与 fail 都带；**无 trace 的记录没有**）与 `.runs/<id>/trace.json` 的 `trace.census`；**文本输出零新增**（逐字节输出契约不动），失败文案也不带计数。

## 证据锚（`requiresEvidence`）

上节的补救是**报告面**；这一节是**加载期**的守卫：每条 case 的 `expect` 至少要有一条**在空投影下会红**的断言（证据锚），否则加载即拒绝。`dsh-eval` 与 `runEvalCase` 两条入口都执法，报错文案一致。

极性由 matcher 对象自报，判据是**工厂 + 参数**，不是工厂名：

| 形态 | 极性 |
|---|---|
| `toolNotCalled` / `userMessageTextExcludes` | 负向（自报 `requiresEvidence: false`） |
| `subagentDispatchCount(m, 0)` / `subagentCompletedCount(m, 0)` | 负向（**参数**为 0 才负向） |
| `subagentDispatchCount(m, n>0)` / `subagentCompletedCount(m, n>0)` | 正向 |
| 其余框架 matcher（`toolCalled`、`finalTextIncludes`、`assistantTextIncludes`、`toolMounted`…） | 正向 |
| 自定义 matcher（未声明） | 正向（缺省要求证据） |

- **自定义 matcher**：语义为负向的，在返回对象上写 `requiresEvidence: false` 即可加入契约；其余不用管（缺省要求证据）。
- `requiresEvidence(matcher)`：该判据的公开读取面（`true` = 它是证据锚）——校验与自定义封装可用它，不必复述字段名。
- **`inspect` 豁免（显式声明制，非已验证）**：case 声明 `evidence: 'inspect'` 且带 `inspect` hook 时，加载期豁免本规则。豁免的正当性是「**inspect 读了原始证据**」，不是「inspect 存在」：hook 收到 workspace 与 trace（**无 trace 时收到 `undefined`，由 case 自己响亮失败**），可能遍历原始 session 事件（`trace.sessions[].events`，绕过宽松投影、免疫降级），也可能什么都不读——框架审计不了，所以豁免按**显式声明**给而不按 hook 存在性给：一行 `inspect: () => {}` 不足以放行全负向 case；**声明而无 hook、hook 而无声明（且无 matcher 锚）都会被拒**。声明了的 case 在报告里带 `evidenceAnchor: 'inspect'` 字段（唯一的声明式锚；matcher 锚的 case 不带该字段），让"证据面没被审过"在 CI 产物里可见，而不是看起来和别的绿灯一样。
- **射程外**（不做过度承诺，写在这里以免误以为会被拦）：退化参数（`toolSequence([])`、`finalTextIncludes('')`、`finalTextMatches(/.*/u)` 形态正向、实际恒真）、半降级（`requestHeaders` 在而 `toolNames` 空）、以及"正向断言断言了一件与本 case 无关的事"（写作纪律，机械面覆盖不了）。
- 典型迁移：一条只写 `toolNotCalled(/^coggit_/)` 的隔离 case，补一条存在性正向断言（例如 `finalTextMatches(/\d/u)`——任务要求给数字时必须给得出）。

## Mock script helpers

- `toolCallStep(name, args)`：一步「模型调工具」，结束于 tool-calls；
- `textStep(text)`：一步「模型说话」，结束于 stop（turn 收束）。

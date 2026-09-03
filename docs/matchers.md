# Trace matchers 与 mock helpers

全部从包根导入：`import { toolCalled, … } from '@catheadowl/dsh-eval'`。

断言对象是 dsh session 事件投影（`src/trace.mjs` 的 `EvalTrace`），不只是
「模型产出」：`requestHeaders` 投影模型被挂载的工具与 system prompt（输入
面），`userMessages` 投影 user-role 的模型可见输入面（任务 prompt、插件
steer、注入上下文）——这让 mock 能断言插件的**驱动级 steer**，而不只断工具
选择或最终文本。

## 工具面

- `toolCalled(name)` / `toolNotCalled(name)`：工具被/未被调用（字符串或
  RegExp）；
- `firstTool(name)`：首个工具调用是它（慎用——探索在前合法，意图 case 通常
  用 `toolCalled`）；
- `toolSequence(names)`：按序子序列；
- `toolCallArgs(name, subset | predicate)`：参数子集匹配（或谓词，收 parsed
  与 raw）；
- `toolResultFor(name)`：匹配的调用有结果配对；
- `toolResultIsError(name)` / `toolResultSucceeded(name)`：结果
  `isError === true` / 不为 true；
- `toolResultTextIncludes(name, substring)`：结果文本含子串。

## 文本面

- `finalTextIncludes(substring)` / `finalTextMatches(re)`：最后一个非空
  assistant 文本（mock 层断言的是脚本终步的确定性文本）；
- `assistantTextIncludes(substring)`：**任一** assistant 文本含子串——
  turn-close 门禁 splice 反馈步骤、`finalText*` 被截走时的 case 级出口。

## 模型可见面（输入侧）

- `systemPromptIncludes(substring)`：组装后的 system prompt 含子串；
- `toolMounted(name)`：工具出现在某个 request/header 的挂载列表；
- `userMessageTextIncludes(source, substring)` /
  `userMessageTextExcludes(source, substring)`：按 `source` 过滤的
  `user/message` 文本含/不含子串。`source` 用字符串/RegExp 匹配 `plugin`
  名（如 steer 生产方），或谓词取整个 `source`——steer 在持久化日志里没有
  专名事件（`agent.steer()` 落为 `user/message`），区分靠 `source`
  （插件 steer 为 `{ kind: 'plugin', plugin: '<id>' }`，任务 prompt 为
  `{ kind: 'user' }`）。

## Mock script helpers

- `toolCallStep(name, args)`：一步「模型调工具」，结束于 tool-calls；
- `textStep(text)`：一步「模型说话」，结束于 stop（turn 收束）。

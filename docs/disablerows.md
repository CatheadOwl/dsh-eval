---
description: disableRows 边界契约——按 loader 行 id 禁用插件行的通用机制、turn-close 门禁 splice 与 finalText 失效的交互根因、case/config 取值优先级
---

# `disableRows` 与 turn-close 门禁边界契约

`disableRows: string[]` 是通用机制：按 loader 行 id 在本次 run 的 overlay 里
禁用任意插件行（`- id: <row> / disabled: true`，与 `session-title-llm` 同一
跨层禁用机制）。框架对行 id 无任何内置知识，任何插件都可以成为禁用对象。
取值优先级：**case 声明 > config 默认 > 不禁用**——case 级 `disableRows: []`
是合法的显式「全启用」，专门用来在默认禁 gate 行的包里恢复 gate 交互 case
的装载。

## 为什么需要它

首要使用场景是 turn-close blocking gate：gate 会在 turn 收尾自动运行并向
inbox splice 反馈。当 case 的**终态本身**就是 gate 判违规的状态（skip 语义
的断链现场、非 git 工作区的 doc-link 报错现场等），splice 会驱动模型产生
脚本之外的额外 step，`finalText*` 断言随之失效。

eval 的临时工作区通常**不是 git 仓库**——doc-link 类 gate 在其中只会以 git
报错成 blocking 并 splice 反馈耗尽脚本，因此测插件工具面的包普遍在
`dsh-eval.config.mjs` 里默认 `disableRows: ['gates']`。

## 契约

- 默认**不声明** = 所选 profile 装载的插件照常运行（gate 交互 case——如断言
  gate steer 的 `userMessageTextIncludes`——依赖此默认）。
- 声明 `disableRows: ['gates']`（case 级或 config 级）= 本次 run 禁用 gates
  插件行（行 id 权威：`@catheadowl/dsh-extras` 包的 `cordis.patch.yml`
  `- id: gates`——兄弟 dsh 插件包），终态违规不再触发 splice，`finalText`
  保持「脚本终步文本」的确定性语义。禁用其他插件行同理，行 id 以该插件包
  的 patch 声明为准。
- gate 交互 case 在默认禁用的包里声明 `disableRows: []` 显式恢复装载。
- 不依赖插件开关的断言出口：`assistantTextIncludes`（断言脚本台词出现过，
  不要求是最终文本）。终态干净时仍应优先 `finalText*`。
- per-gate 白名单（如只关某个 gate）暂不支持：per-gate disable 需要 gate
  框架侧先提供 config 面。

## 失败自解释

mock case 的 `finalText*` 失败若伴随 trace 里可见的**非宿主**插件注入 user
消息（gate 反馈、steer 等任何形态），失败输出会点名注入插件并提示上述出口
（`disableRows`，或把交互纳入脚本预期 / `assistantTextIncludes`）——确定性
被打破时框架当场解释机制，无需读 raw trace 排查。

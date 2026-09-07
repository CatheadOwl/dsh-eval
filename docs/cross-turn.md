---
description: followups 跨轮驱动契约——case 声明 followups 后 overlay 换装 eval 多轮 driver、后台子 agent 的 settle 等待语义、mock 脚本跨轮共享 cursor 的编排规则与 bounded-redispatch 断言面
---

# followups：跨轮异步驱动

单轮 behavior case 的驱动模型覆盖不了 defer 自愈闭环：「turn 收尾派发 fork 子 agent → 子 agent 落盘修复 → **下一轮** stop 重扫转绿（或每轮一次有界重派）」。case 声明 `followups` 即启用跨轮驱动。

## 为什么是 driver 行而不是 CLI resume

实测定案（「跨轮异步修复驱动」FR 调研，见开发仓的 eval 状态板记录）：

- headless runner 在主 agent 首次 idle 即退出，**进程退出会把 in-process 后台子 agent 当场 abort**（fire-and-forget 子 agent 存活窗口 = driver 的生命周期）；
- dsh CLI 无 resume 表面（one task per invocation；resume 只在 cordis config 层）。

因此 `followups` 的实现是 overlay 换装：disable `headless-runner` 行 + insert 本包的 `eval-multi-turn-driver`（`src/driver/multi-turn-driver.mjs`，file:// 挂载，与 mock adapter 同机制）。driver 语义：

1. 以 case `task` 驱动 turn 1，等主 agent idle；
2. 每个 followup 之前，**等待后台子 agent settle**（全局 `session/event` 投影：subagent 会话自 `turn/start` 起 pending、`turn/end` 止；空集后再过 250ms 静默宽限才放行；上限 `settleTimeoutMs`，默认 60s，超时报错退出）；
3. 提交 followup（普通 user message）驱动下一轮；
4. 最后一轮收尾后**同样等待一次 settle**——最后一轮的 turn close 也会派发（defer gate 每次失败 stop 都派 fixer），不等就会在退出时静默截断它们；「已派发 ⇒ 可观测结局」对每一轮成立；
5. flush、按 headless 同款输出契约退出（最后一条非空 assistant 文本到 stdout；最后 turn `completed` → exit 0）。

## case 声明

```js
export default {
  id: 'gates-mock-defer-self-heal',
  mode: 'mock',
  disableRows: [],            // gate 交互 case 需显式装载 gates 行
  task: '…turn 1 任务…',
  followups: ['rescan now'],  // 每项 = 一个额外驱动轮
  settleTimeoutMs: 30_000,    // 可选；等后台子 agent 的上限
  script: { steps: [/* 跨轮共享 cursor，见下 */] },
  expect: [/* matchers */],
}
```

校验：`followups` 必须是非空 string[]；`settleTimeoutMs`（可选）必须是正有限数。仅声明 `settleTimeoutMs` 而无 `followups` 无效（不校验、不生效）。

## mock 脚本编排：单 cursor 跨轮共享

mock adapter 是单实例、单 cursor：**每次模型调用按序吃一步，不区分轮次与 会话**。跨轮 case 的 steps 是全运行编排——主 turn 步骤、子 agent 步骤、后续轮步骤交错排列：

```js
steps: [
  textStep('turn 1 done'),          // 主 turn 1 收尾 → turn close 派发 fixer
  textStep('fixer child answer'),   // fixer 子 agent 的首个（唯一）模型调用
  textStep('turn 2 done'),          // followup 轮的收尾
]
```

注意：turn-close blocking gate 的 splice 反馈步骤（见 [disablerows.md](disablerows.md)）同样消耗 cursor——编排跨轮脚本时先数清每轮会被 splice 几步。

## 断言面

- 派发与完成：`subagentDispatched` / `subagentCompleted`（见 [matchers.md](matchers.md) 派发面）；
- **有界重派节律**：`subagentDispatchCount(matcher, expected)`——精确断言匹配 label 的派发总数（「每轮恰一次、N 轮共 N 次、不更多」）；
- 跨轮重扫：`userMessages` 投影带全部轮次的 `user/message`，`userMessageTextIncludes` / `userMessageTextExcludes` 按 `source` 断言某轮是否被 gate steer（例如 turn 2 重扫转绿 → 无新的 gates steer）。

## 边界

- **settle 宽限是启发式，不是 barrier**：250ms 静默宽限可被「慢派发」击穿——若某插件的 turn-close 派发在主 agent idle 后 >250ms 才发出子 `turn/start`，driver 会空集放行、followup 先行（mock 面表现为脚本错步、通常 loud；real 面表现为轮次与子 agent 并发交叉）。宿主没有「派发完成」事件可用，这是对不存在信号的保守近似。
- **时间预算叠加**：driver 的 settle 等待（默认每轮上限 60s）叠加在 case `timeoutMs`（runner 的 spawn 超时）之内。轮数 × settle 上限若超过 `timeoutMs`，先到的是 spawn 超时（结果 `timedOut`）而非 settle 报错——多轮 case 应按轮数放大 `timeoutMs`。
- `subagentCompleted` 的「完成」以子会话产出非空 assistant 文本为准；被早夭 abort 的子日志可能不含 `subagent/descriptor`（label 投影为空）——见 matchers.md 派发面的早夭边界。要断言「每个派发都跑完」（而非任一跑完），用 `subagentCompletedCount`。
- real 模式下 `followups` 同样可用（driver 不依赖 mock），但轮次内容非确定——real 意图 case 通常不需要它。

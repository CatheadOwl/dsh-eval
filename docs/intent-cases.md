---
description: Spec for real intent cases — when to write one, minimal assertion face (toolCalled/toolCallArgs/inspect guards), fixture and gate-interaction avoidance, CI semantics
---

# Real 意图 case 规约

behavior real 断言「自然语言意图 → 工具选择与参数路由」，mock 断言「工具管线与写入 round-trip」：两层互补，不互相替代。

## 何时写（触发表）

满足任一条即值得写一条 real case：

1. 注册了模型可见工具（happy path ≥1）；
2. 目标存在等价手工路径（可对照）；
3. 描述 steering 变更（模型可见输入面变了）；
4. 分支由数据面状态分流（成对 case，各断一个分支）；
5. 拒绝路径面向模型消费（remedy 委派边界——模型要读懂失败并转述）；
6. 有误触发风险（负向 `toolNotCalled` case）。

> 触发表的完整论证（依据与失败启发集）属于通用的意图面 e2e 方法论；本表即其 dsh 承载面的规范版，自足使用。

## 断言面（最小化）

- `toolCalled`（不是 `firstTool`——探索在前合法）+ `toolCallArgs` 子集（路由 payoff 在参数对）+ 语义关键时 `toolResultTextIncludes` 状态锚（如 `"status": "repaired"`）；
- 不约束措辞与中间步骤——意图测试的模型措辞天然漂移，工具选择才是契约。

## 最小完整示例

```js
// <plugin>/eval/behavior/real/intent.eval.mjs —— mode 缺省即 'real'，可省略
import { toolCalled, toolCallArgs } from '@catheadowl/dsh-eval'

export default {
  id: 'my-tool-intent',
  task: '把 demo 目录里的旧配置文件清掉',   // 自然语言；不出现工具名亦可
  expect: [
    toolCalled('my_tool'),
    toolCallArgs('my_tool', { path: 'demo/config.old' }),   // 子集断言
  ],
}
```

无凭证时 auto-skip；CI 门禁加 `--fail-on-skip` 防「根本没跑但成功」。运行：`npx dsh-eval run --profile <headless 形 profile> eval/behavior/real`。

## 守卫

- `inspect` 守结果面 + 反捏造（不重建旧路径、不凭空造文件），不管模型走什么中间路径；
- fixture 必须可区分（不同分支的 fixture 不能靠巧合区分）；
- turn-close 门禁交互：见 [disablerows.md](disablerows.md)（case 级出口 `assistantTextIncludes`；splice 步骤与脚本本体的区分尚无框架级方案）。
- 环境前提：意图测量的候选面必须受控（钉环境行，防假红/假绿）——守卫管结果面，环境面在断言之前，见 [environment.md](environment.md)。

## CI 语义

- 无凭证 auto-skip；CI 门禁用 `--fail-on-skip` 防「根本没跑但成功」。

## 实例

「同一意图 × 数据面分流」成对设计的可模仿形态：一组意图集检查（review 通道断言理解）配一组同意图的行为三连——repair / discovery / oldpath-missing（behavior 通道断言执行）——同一意图在两个数据面上分流成对，互为回归网。（曾有 no-evidence 第四成员钉「预判徒劳仍委派」，因预判徒劳的调用被模型类一致绕行、轨迹断言不可钉而撤出；成员数以 md-rename 的 `eval/behavior/real/` 现状为准。）

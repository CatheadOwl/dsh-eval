---
description: real 意图 case 规约——何时写的触发表、断言面最小化（toolCalled/toolCallArgs/inspect 守卫）、fixture 与门禁交互规避、凭证 auto-skip 与 CI 语义
---

# Real 意图 case 规约

behavior real 断言「自然语言意图 → 工具选择与参数路由」，mock 断言「工具
管线与写入 round-trip」：两层互补，不互相替代。

## 何时写（触发表）

满足任一条即值得写一条 real case：

1. 注册了模型可见工具（happy path ≥1）；
2. 目标存在等价手工路径（可对照）；
3. 描述 steering 变更（模型可见输入面变了）；
4. 分支由数据面状态分流（成对 case，各断一个分支）；
5. 拒绝路径面向模型消费（remedy 委派边界——模型要读懂失败并转述）；
6. 有误触发风险（负向 `toolNotCalled` case）。

> 触发表的完整论证（依据与失败启发集）属于通用的意图面 e2e 方法论；本表即
> 其 dsh 承载面的规范版，自足使用。

## 断言面（最小化）

- `toolCalled`（不是 `firstTool`——探索在前合法）+ `toolCallArgs` 子集
  （路由 payoff 在参数对）+ 语义关键时 `toolResultTextIncludes` 状态锚
  （如 `"status": "repaired"`）；
- 不约束措辞与中间步骤——意图测试的模型措辞天然漂移，工具选择才是契约。

## 守卫

- `inspect` 守结果面 + 反捏造（不重建旧路径、不凭空造文件），不管模型走
  什么中间路径；
- fixture 必须可区分（不同分支的 fixture 不能靠巧合区分）；
- turn-close 门禁交互：见 [disablerows.md](disablerows.md)（case 级出口
  `assistantTextIncludes`；splice 步骤与脚本本体的区分尚无框架级方案）。

## CI 语义

- 无凭证 auto-skip；CI 门禁用 `--fail-on-skip` 防「根本没跑但成功」。

## 实例

「同一意图 × 数据面分流」成对设计的可模仿形态：一组意图集检查（review
通道断言理解）配一组同意图的行为四连——repair / discovery / no-evidence /
oldpath-missing（behavior 通道断言执行）——同一意图在两个数据面上分流
成对，互为回归网。

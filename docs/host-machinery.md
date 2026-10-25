---
description: Relationship between the host's in-tree test machinery and this package — the machinery inventory, the three-layer relationship (mechanism lineage, contract, judgment semantics), and a scenario-to-machinery dispatch table for plugin authors
---

# 宿主源码机台与本包的关系

dsh 宿主自带一整套 in-tree 测试机台:根 scripts 的多轨 vitest 与 `packages/test-support/` 组。本包**不是它们的替代,而是它们中为宿主自测发明的机制的树外消费者化**——插件作者拿不到宿主仓库机台(support-tier,不随 npm 件走),本包把同样的机制缝组合成独立可装的 eval 面。本页说明关系,并给「给定场景该用哪个机台」的选型表。

## 宿主机台一览

| 机台(按名) | 层次 | 判读形态 | 对插件作者 |
|---|---|---|---|
| vitest 全树单测(`*.spec.ts`) | 进程内单元 | 断言 | 不可用(宿主仓库内) |
| `test:expected` 快照轨(`DSH_SNAPSHOT=refresh` 重录;语料在 `apps/cli/tests/profiles/headless` 的 expected JSONL) | profile 驱动 e2e | 快照比对 | 不可用 |
| `test:gui`(`packages/client` + `packages/host`,jsdom) | 组件 | 断言 | 不可用 |
| `test:bench` / `bench:memory` | 性能 / 内存压力 | 基准 | 不可用 |
| `test-support/llm-replay` | LLM 插件:按录制的 Session JSONL 回放模型流,父/子会话各取脚本,`replay.override.json` sidecar 补崩溃/取消/注入重试等不可持久化场景 | 与快照轨配合 | 形态可参考,非本包一等模式 |
| `test-support/llm-mock-server` | Messages 兼容 HTTP/SSE 故障服务器(重置/停滞/坏块/限流/5xx/补全/工具调用,可种子化混合故障) | 请求捕获断言 | 不可用 |
| `test-support/loader-smoke`(`runLoaderSmoke` + scripted adapter `cli-mock-llm`) | 进程内 loader 驱动 | 断言 | 不可用(未导出公共 API、绑 vitest) |
| `test-support/agent-loop-testkit` | AgentLoop 测试前置服务 | 断言 | 不可用 |
| `test-support/client-runtime` | jsdom 槽位测试台 | 断言 | 不可用 |
| `test-support/session-snapshot` | profile 驱动测试的 session 快照协议适配 | 快照 | 不可用 |

`test-support` 组自述定位是 support-tier infrastructure——包「获得产品契约与产品消费者后才升出本组」,即它们不进发布件。本包填的正是这块空:树外、独立 npm 安装、驱动真实 CLI。

## 三层关系

**机制血缘**。本包的执行面(headless 一次性 CLI)、证据链(session JSONL,`compression: 'none'` 明文逐行)、注入面(`--patch` overlay:adapter insert + 默认模型重指 + 禁用标题生成)与无 key 先例(scripted adapter 的 overlay 组合写法)都源自宿主为自测发明的机制;staging 的硬约束(boot 每次重写 profile 根 `cordis.yml`,所以 profile 目录复制而非链接)同样是宿主行为决定的。

**契约关系**。本包的 mock adapter(`EvalMockAdapter`)是宿主 `LlmAdapter` 基类线上契约(`prepareCall` / `resolveModel` / `stream`)的树外实现。契约归宿主所有;宿主演进时按 [host-wiring/host-contracts](host-wiring/host-contracts.md) 的触发表重验,本包跟进而非定义。

**判读分野**。宿主 e2e 用快照判读(expected JSONL,整段重录刷新);本包用 matcher 断言,判读冻结在作者时(unittest 语义,见 [concepts](concepts.md))。两者是 deliberate 的分岔:插件作者需要的是可组合、失败信息具名的断言面,而不是每次宿主观测面变化就要重录的快照。

## 场景选型(该用哪个机台)

| 场景 | 用什么 | 备注 |
|---|---|---|
| 插件行为:意图→工具调用、注入面、组合图真实接线 | 本包 behavior case(`mode: 'mock'`) | script 步进 + trace matcher,免 key |
| 完全自造的多轮剧本(固定模型输出) | 本包 mock script | 每步一段流;粒度见 [matchers](matchers.md) |
| 真实 loop 行为 + 固定模型输出(录制回放) | 宿主 `llm-replay` 的形态 | 本包 case mode 仅 `real` / `mock`,录制回放不是一等模式;树外走 overlay 自组合超出本包契约 |
| 插件输出的可理解性(判读类,非串回归) | 本包 comprehension review(可选 `--judge` 第一道) | 见 [review](review.md) |
| 真模型 A/B 实验(臂 × 重复 × 守卫 × 聚合) | 本包 [experiments](experiments.md) | |
| provider 故障 / 恢复语义(网络层) | 宿主 `llm-mock-server` 的形态 | 本包不覆盖该层(本包的 mock 在 LLM adapter 契约层,不在 HTTP 面) |
| 插件 client / UI 半(浏览器面) | 暂无树外机台 | 宿主 jsdom 机台不随发布件走;本包不覆盖 UI 面,可理解性以 review 兜底 |
| 纯单元逻辑(不涉 agent loop) | 任意测试框架 | 本包不涉及;何时值得写成 case 见 [intent-cases](intent-cases.md) |
| 宿主自身 / 贡献上游 | 宿主自家机台 | 本包面向插件作者,宿主开发态不在射程内 |

选型原则一句话:**凡是要「真实接线 + 确定性判读」的插件语义面,本包;凡是宿主自身、provider 网络层或 UI 面,宿主机台或暂无树外通道。**

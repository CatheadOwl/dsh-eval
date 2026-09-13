---
description: 行为实验契约——defineBehaviorExperiment 的形态（臂 = case 字段覆写、预注册 decisionRule 与定义指纹）、臂覆写深合并基线保真、守卫与 invalid 纪律、产物形态、判读留消费侧的射程边界
---

# 行为实验：臂 × 重复 × 聚合

回归 case 断言一个确定性契约一次；行为实验测量一个**分布**——同一 case 在若干**臂**（case 字段覆写）下各跑 N 次，逐 run 抽指标、逐 run 守卫、做描述统计。用于「注入/文案对模型行为的概率性效应」一类问题（单次运行的通过/失败回答不了「更倾向于」）。

全部符号走 `@catheadowl/dsh-eval/experimental` 入口（无兼容承诺）；判读归人，实验**没有** pass/fail 退出码语义。

## 形态

```js
import { defineBehaviorExperiment, executeBehaviorExperiment, writeBehaviorArtifacts } from '@catheadowl/dsh-eval/experimental'

const experiment = defineBehaviorExperiment({
  id: 'relates-ab',
  hypothesis: 'breadcrumb 关联注入减少定位目标前的探索搜索',
  arms: [
    { id: 'treatment' },                                        // 不覆写 = 基线臂
    { id: 'control', overrides: { rowConfig: { prompt: { disabledProviders: ['breadcrumb-description-enricher'] } } } },
  ],
  runs: 10,
  metrics: trace => ({ searchCallsBeforeTarget: extract(trace) /* 消费者自定 */ }),
  guard: (metrics, { arm }) => metrics.injectionSeen === (arm === 'treatment'),
  decisionRule: 'H1 成立当且仅当 treatment 的 searchCallsBeforeTarget 中位数低于 control 且 success 率不降；无差异或 success 下降记为 tricky，不折算',
})

const result = await executeBehaviorExperiment(experiment, baseCase, {
  profile: 'headless',
  cliPath: chain.cli,          // resolveDshCliChain 结果
  onRow: row => console.log(row.caseId, row.ok, row.guardOk),
})
writeBehaviorArtifacts(result, '.runs/relates-ab-20260913/')
```

| 字段 | 必填 | 语义 |
|---|---|---|
| `id` | ✓ | path-safe；产物与报告以其为键 |
| `hypothesis` | ✓ | 预注册假设（报告原文复现） |
| `arms` | ✓ | `{ id, overrides? }[]`，id 唯一且 path-safe |
| `runs` | ✓ | 每臂运行次数——**预注册样本量**，不给默认值 |
| `metrics` | ✓ | `(trace, context) => object`：数值/布尔抽取，语义归实验作者 |
| `guard` | | `(metrics, context) => boolean`：逐 run 守卫；缺省 = 凡有 trace 的 run 皆 guard-clean |
| `decisionRule` | ✓ | 预注册判读标准（先写死，防事后找补）；报告原文复现 |

`overrides` 白名单：`task` / `expect` / `prepare` / `rowConfig` / `disableRows` / `followups` / `settleTimeoutMs` / `timeoutMs`——**臂差异就是既有 case 字段的覆写**，没有独立于 case 之外的臂配置通道；`id`（框架铸造 `<caseId>:<armId>:<index>`）与 `mode`（实验内模式统一）不可覆写。

## 基线保真（臂层深合并）

臂的 `rowConfig` 覆写与 case 自身的 `rowConfig` **深合并**：臂未提及的行原样保留；提及的行递归合并，标量与数组整替。**只写差异键的行为与重述全部键完全一致**——臂间基线不会因整段替换语义漂移。

注意层级：深合并只发生在「臂覆写 × case 声明」之间；case 级 `rowConfig` 对 profile 基线仍是[整段替换](rowconfig.md)（重述义务不变）。

## 守卫与 invalid 纪律

- **无 trace 的 run 记行级具名失败**（带 `traceGap` 诊断），不静默剔出分组；
- **守卫失败的 run 退出聚合**（防「泄漏 = 假治疗效应、静默失败 = 假零结果」），但不算错误——计数可见；
- **零 guard-clean run 的臂判 INVALID**：具名列出每个失败行的原因，**绝不渲染成空统计单元**；
- 每个克隆 run 的 `expect` 经官方入口 `evaluateMatchers` 评估（内联证据锚执法）；`expectFailures` 记在行上，是结果数据不是失败信号。

## 产物

`writeBehaviorArtifacts(result, dir)` 落盘 `results.json`（完整结果对象）与 `summary.md`（hypothesis、decisionRule 原文、`definitionSha256` 指纹、逐臂状态计数、guard-clean 口径的描述统计、invalid 臂具名清单）。指纹 = 定义数据字段（id/hypothesis/arms/runs/decisionRule）的稳定序列化 sha256——函数代码不计入（指纹锚的是预注册文本）。逐 run 的 stdout/stderr/trace 走 `options.artifactsDir`（`<dir>/<armId>/<index>/`）。

## 射程外

- **判读与显著性不上收**：`decisionRule` 是文本 + 指纹，不是可执行判据；显著性计算、效应量、人工判读都留消费侧——真模型实验不伪装成全自动测试，也不进 `pnpm test`/gates 路径（real 模式凭证 + spawn 约束）；
- **指标语义不上收**：`metrics` 是消费者闭包，框架只做描述统计（`rate` / `median`）；
- 退出码语义归消费侧脚本（操作失败——invalid 臂、执行错误——由消费脚本决定如何计）。

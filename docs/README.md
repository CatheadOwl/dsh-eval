---
description: Docs index for the dsh-eval published doc set — routing table into wiring, contracts, matchers, review, environment discipline, and known issues
---

# dsh-eval · docs index

| 文档 | 主题 |
|---|---|
| [host-wiring.md](host-wiring.md) | 安装与宿主接线：peer 依赖（dsh-llm）、构建 CLI、profile、模型选择（real 模型来源链与钉版）、凭证、spawn 要求 |
| [review.md](review.md) | comprehension review：实验定义、空白环境 reviewer、产物清单、评审规则与 judge 第一道 |
| [matchers.md](matchers.md) | trace matcher 与 mock helper 全集 |
| [concepts.md](concepts.md) | 概念对照：主流 agent eval 词汇（dataset / metric / LLM-as-judge / trajectory / CI…）到本包 cases / matchers / review 的映射与「刻意不做」档 |
| [disablerows.md](disablerows.md) | `disableRows` 与 turn-close 门禁边界契约 |
| [rowconfig.md](rowconfig.md) | `rowConfig` 行 config 覆写契约（整段替换语义、形状限制、与 disableRows 分工） |
| [environment.md](environment.md) | 实验环境纪律：环境认知与混杂控制——real run 环境面四分法、staging 覆盖边界与漏入通道、假红/假绿两形态、行级钉面默认与 case 级恢复的方向原则 |
| [cross-turn.md](cross-turn.md) | `followups` 跨轮异步驱动契约（driver 行换装、子 agent settle 等待、mock 单 cursor 编排、有界重派断言） |
| [experiments.md](experiments.md) | 行为实验契约：臂 = case 字段覆写 × 重复 × 守卫 × 聚合（`defineBehaviorExperiment`、臂覆写深合并、invalid 纪律、预注册 decisionRule） |
| [intent-cases.md](intent-cases.md) | real 意图 case 规约：何时写、断言面、守卫、CI 语义 |
| [report.md](report.md) | 机器可读报告（`--format json` / `--report`）结构 |
| [runner-api.md](runner-api.md) | 程序化 runner API：`runEvalCase` options 契约、EvalRunResult 字段、跨档取 `cliPath` |
| [known-issues.md](known-issues.md) | 已知问题与规避 |
| [experimental.md](experimental.md) | `experimental` 子路径符号清单（逃生面，无兼容承诺） |

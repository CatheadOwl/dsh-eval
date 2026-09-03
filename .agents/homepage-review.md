---
description: homepage-review 族技能在 eval 包的实例注记——派遣触发条件与 Background rules seed 指针；dispatch 模板与验收断言 SSOT 在族技能 homepage-review
---

# homepage-review · eval 包实例注记

**问题**：README 是本包独立 repo 的主页（npm 页正文同步），不是工作手册。
结构性改动后按族技能派遣一轮评审。

**dispatch 模板与验收断言 SSOT**：族技能 homepage-review
（skills/review-evals，名称引用——按 eval AGENTS 自含纪律不写开发仓路径）。
派遣时按其模板占位符取值：`{{包名}}`=`@catheadowl/dsh-eval`，
`{{目标页}}`=包根 `README.md`，`{{files 白名单展开面}}`=`bin/`、`src/`、
`docs/`、`README.md`、`LICENSE`（`tests/`、`scripts/` 不发布），`{{宿主名}}`=
dsh；机械预扫与规格专属验收断言照族技能执行。

**Background rules**：dispatch prompt 的 Background rules 段嵌入本包 rules
seed 原文——[.agent/rules/homepage-quality.md](../.agent/rules/homepage-quality.md)
（含 HP-n 条目与 intentional-design 豁免清单），finding 必引 rule id。

## eval 专属增量（族技能之上的 delta）

- **触发条件**：README 主页**结构性**改动后派遣一轮（内容微调不触发）。
- **双读者前提**：README 面向双读者（消费者 + 维护者）是本包刻意选择
  （seed 豁免清单已载）——骨架/分工建议须尊重该前提再提优化。

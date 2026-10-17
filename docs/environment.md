---
description: Experiment-environment discipline for real eval runs — staging coverage boundary, ambient-surface confounding, and row pinning with case-level restore
---

# 实验环境纪律（环境认知与混杂控制）

## 为什么有这一篇

real case 是一次**测量**：断言「自然语言意图 → 被测插件工具的路由」。测量成立的前提是单变量——模型可见面里每多一个不受控的候选（工具、技能、steer），测到的就多一分「被测物 vs 环境」的竞争，少一分被测物本身。**做实验的人必须知道并控制自己的环境**：不知道环境里有什么，绿了红了都不知道在测谁。

经典方法学的对应词是**混杂（confounding）与内部效度**：未控制的第三变量让结果不可归因于被测物，进而不可复现——同一代码在两台机器（或同一机器的两个宿主检出）上结果不同，回归信号失效。对策三术（随机化 / 限制 / 匹配）中本包语境能落地的是**限制**：把环境面从测量面上移除。agent 评测界的同构惯例是环境固定——SWE-bench 类 harness 为每个实例构建钉死依赖的容器，分数才跨机器可比；本包 real run 的暂存 home 是同一原则的轻量实现，但**覆盖有边界**（下节），边界之外是实验者的自觉面。

混杂的两种失败形态，**假绿比假红更危险**：

| 形态 | 机理 | 危害 |
|---|---|---|
| 假红 | 环境面抢走路由：模型 load 目录技能或改走等价路径，断言工具调用判负 | 稳定噪音盖住真回归 |
| 假绿 | 环境面把终态做对而**被测工具从未被调用**，只断言终态的 case 照样过 | 契约被违反而绿灯——测量静默归零 |

## real run 的环境面与 staging 边界

每条 real case 在隔离临时 `DSH_HOME` 与临时 workspace 中启动（接线事实见 [host-wiring.md](host-wiring.md)「环境面」）。暂存面（`stageSandboxHome`）拷贝 profile store 与托管凭证文档，不含 settings。「实验环境」由四类面组成，前两类框架替你管，后两类**你自己管**：

| 面 | 内容 | 控制正字 |
|---|---|---|
| 模型 | profile 合成的 `agent-default-model` 行 | profile patch 钉版或 case 级 `rowConfig`；不钉则随宿主 bundle 默认漂移（[host-wiring.md](host-wiring.md)「模型选择」） |
| 装配 | profile 插件行 + patch + 本次 overlay | `disableRows` / `rowConfig`（[disablerows.md](disablerows.md) / [rowconfig.md](rowconfig.md)） |
| 宿主基座 | 工具族、steer、注册表/工具行的宿主检出代差 | 随宿主检出走；行为可疑先对 deepseek-harness 检出核源，不猜 |
| **环境性表面** | 目录技能、宿主 settings 节、用户目录 | 见下表——staging 只盖住一部分 |

环境性表面的细账（已实证的漏入通道在此）：

| 来源 | staging 覆盖？ | 说明 |
|---|---|---|
| `<agentsHome>/skills`（用户技能目录） | **否——已实证漏入** | 在暂存 DSH_HOME 之外，宿主本地技能 provider 照常发现（发现根表见宿主 skills 子系统文档的 *Local discovery priority*）：机器装了什么技能，real run 就看见什么 |
| `customSkillDirs`、项目 `.dsh`/`.agents` 根 | 未逐一实证 | 同属发现根表成员；fixture 通常干净，但环境承诺应显式核过而不是默认 |
| `<dshHome>/skills` | 是（随 home 拷贝） | — |
| settings 节（模型选择、多 provider） | 否（设计如此） | eval 模型严格等于 profile 行配置，见 host-wiring「模型选择」 |

## 控制通道与方向原则

- **行级钉面**：`disableRows`（机制契约见 [disablerows.md](disablerows.md)）。行 id 来自宿主组合表（例：`skill-filesystem` = `@deepseek-ai/dsh-skill-filesystem`），本框架对行 id 无内置知识——**钉什么、为什么钉，是使用者的环境判断**，本篇提供判断框架。
- **方向原则：默认钉、case 级开**。不变量（本包测被测插件）住 config 默认；偏差（某 case 显式要环境面）住 case 声明（case 级整表替换 config 默认）。这样选是因为失败不对称：默认污染的失败是**静默**的——忘写声明的 case 假红假绿随机器漂移，不会提醒你；默认钉面的失败是**响亮**的——需要环境面的 case 当场红、就地补声明。
- **「真实用户环境里表现如何」是外部效度问题**：由显式设计的 case（case 级恢复环境面）或验收层承担，不是默认环境里的不受控混杂。内部效度（测的是被测物）先于外部效度（像不像用户现场）——前者坏了，后者无从谈起。
- **验证钉面生效**：`--keep-artifacts` 落盘的 session 日志里，模型可见的 `<available_skills>` 目录内容是技能面的直接证据（应只剩运行时注入技能）；首个 `request/header` 的 provider/model 是模型面的直接证据。

## 工作实例：技能目录钉面（extras-ADR-0007 案卷）

某插件包 real 层复跑：基线全过的用例在装有用户技能目录的机器上全数失败——trace 实证模型 load `doc-tools` 技能后用 pwsh 跑 CLI 完成改名（终态正确、断言工具调用判负＝假红）；另一技能把 discovery 用例引去手动编辑且出链未 rebase（行为面劣化）。根因即上表第一行：`<agentsHome>/skills` 在暂存之外。落地：包默认 `disableRows` 增禁 `skill-filesystem` 行（目录来源技能全摘、`ctx.skills.register()` 运行时注入保留），需要技能面的 case 整表重述；验证：`<available_skills>` 目录只剩运行时注入的捆绑技能，原用例复绿且全程未动用户技能文件。

## 与相邻篇的分界

- [disablerows.md](disablerows.md) / [rowconfig.md](rowconfig.md)：**怎么**禁行、覆写行（机制契约）；本篇：**为什么必须管**环境、管哪些面（方法学）。
- [host-wiring.md](host-wiring.md)：staging 拷什么（接线事实）；本篇：覆盖缺口的实验学后果与对策。
- [intent-cases.md](intent-cases.md)：断言面与守卫；本篇是断言之前的环境前提。
- [concepts.md](concepts.md) 的 environment / sandbox 行：框架保证的环境**重置**；本篇是重置覆盖不到处的**自觉面**。

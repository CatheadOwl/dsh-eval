---
description: Experiment-environment discipline for real eval runs — staging coverage boundary, ambient-surface confounding, and row pinning with case-level restore
---

# 实验环境纪律

behavior real 全部 run 适用的环境面规则。环境面清单、失效模式与工作实例为附则一至三；方法论出处见文末 References。

## 规则

1. **单变量**：real case 测「自然语言意图 → 被测插件工具的路由」。模型可见面内不得有不受控候选（工具、技能、steer）——不受控候选每多一个，测得结果向「被测物 vs 环境」的竞争漂移一分。
2. **环境认知**：run 环境按附则一的四类面清点；前两类（模型、装配）由框架与 profile 承接，后两类（宿主基座、环境性表面）由实验者控制。环境内容不知情的 run，其结果不得作归因结论。
3. **默认钉面**：环境性表面默认钉出测量面——config 默认 `disableRows` 禁对应宿主行；需要环境面的 case 以 case 级声明整表替换、显式恢复。方向不得反转：默认污染的失败静默（假红/假绿随机器漂移，附则二），默认钉面的失败响亮（缺环境面的 case 当场红、就地补声明）。
4. **模型钉版**：模型同为环境变量。profile patch 或 case 级 `rowConfig` 钉版（见 [model-selection.md](host-wiring/model-selection.md)）；未钉版的结果不得跨宿主检出具比较。
5. **外部效度显式承担**：「用户真实环境中的表现」由显式恢复环境面的 case 或验收层测量，不得由默认环境的未控混杂承担。内部效度（测的是被测物）先于外部效度（像不像用户现场）。
6. **证据验收**：钉面与钉版以 `--keep-artifacts` 落盘证据验收——模型可见的 `<available_skills>` 目录内容为技能面直接证据（应只剩运行时注入技能），首个 `request/header` 的 provider/model 为模型面直接证据。「跑绿了」不构成钉面已生效的证据。

## 附则一：环境面清单与 staging 边界

每条 real case 在隔离临时 `DSH_HOME` 与临时 workspace 中启动（接线事实见 [host-wiring](host-wiring/README.md) 的快速接线路径）。暂存面（`stageSandboxHome`）拷贝 profile store 与托管凭证文档，不含 settings。两条机制事实（隔离 home 常踩的两类坑在此不适用）：**link 按链接重建、永不跟随**——profile 树内的 junction 原样重建为 junction（Windows 下 `cpSync` 会解引用递归、无环守卫，staging 不走这条路），不存在「junction 过拷贝被展开」；**profile 自身 `node_modules` 在暂存 home 里重新 junction 指回真实 store**——同机不变量，暂存内的树外插件解析与真实解析同源。暂存 home 也不需要 home 级 runtime 物化：被驱动的 CLI 在 boot 时把自己的安装闭包注入 Node 解析器（运行时拦截，机制见 explorer plugin-dep-resolution），bundle 行的宿主依赖不落 home 级目录。

| 面 | 内容 | 控制正字 |
|---|---|---|
| 模型 | profile 合成的 `agent-default-model` 行 | profile patch 钉版或 case 级 `rowConfig`；不钉则随宿主 bundle 默认漂移（[model-selection.md](host-wiring/model-selection.md)） |
| 装配 | profile 插件行 + patch + 本次 overlay | `disableRows` / `rowConfig`（[disablerows.md](disablerows.md) / [rowconfig.md](rowconfig.md)） |
| 宿主基座 | 工具族、steer、注册表/工具行的宿主检出代差 | 随宿主检出走；行为可疑先对 deepseek-harness 检出核源，不猜 |
| **环境性表面** | 目录技能、宿主 settings 节、用户目录 | 见下表——staging 只盖住一部分 |

环境性表面细账：

| 来源 | staging 覆盖？ | 说明 |
|---|---|---|
| `<agentsHome>/skills`（用户技能目录） | **否——已实证漏入** | 在暂存 DSH_HOME 之外，宿主本地技能 provider 照常发现（发现根表见宿主 skills 子系统文档的 *Local discovery priority*）：机器装了什么技能，real run 就看见什么 |
| `customSkillDirs`、项目 `.dsh`/`.agents` 根 | 未逐一实证 | 同属发现根表成员；fixture 通常干净，但环境承诺应显式核过而不是默认 |
| `<dshHome>/skills` | 是（随 home 拷贝） | — |
| settings 节（模型选择、多 provider） | 否（设计如此） | eval 模型严格等于 profile 行配置，见 host-wiring/model-selection |

## 附则二：失效模式

| 形态 | 机理 | 危害 |
|---|---|---|
| 假红 | 环境面抢走路由：模型 load 目录技能或改走等价路径，断言工具调用判负 | 稳定噪音盖住真回归 |
| 假绿 | 环境面把终态做对而**被测工具从未被调用**，只断言终态的 case 照样过 | 契约被违反而绿灯——测量静默归零 |

## 附则三：工作实例——用户技能目录截胡意图路由

某插件包的 real 回归套件复跑：基线全过的改名用例在装有用户技能目录的机器上全数失败——trace 实证模型 load 一个封装改名 CLI 的用户技能后用 shell 完成改名（终态正确、断言插件工具调用判负＝附则二假红）；另一个用户技能把 discovery 用例引去手动编辑且出链未 rebase（行为面劣化）。根因即附则一第一行：`<agentsHome>/skills` 在暂存之外。落地：包默认 `disableRows` 增禁 `skill-filesystem` 行（目录来源技能全摘、`ctx.skills.register()` 运行时注入保留），需要技能面的 case 整表重述；验证：`<available_skills>` 目录只剩运行时注入技能，原用例复绿且全程未动用户技能文件。

## References

- Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2023). [SWE-bench: Can language models resolve real-world GitHub issues?](https://arxiv.org/abs/2310.06770) *arXiv preprint* arXiv:2310.06770.
- Nielsen Norman Group. [Confounding variables in quantitative studies](https://www.nngroup.com/articles/confounding-variables-quantitative-ux).
- Pourhoseingholi, M. A., Baghestani, A. R., & Vahidi, M. (2012). [How to control confounding effects by statistical analysis in research](https://pmc.ncbi.nlm.nih.gov/articles/PMC4017459/) *Nephro-urology Monthly*, 4(4).
- SWE-bench. [Evaluation harness reference](https://www.swebench.com/SWE-bench/reference/harness) (official documentation).

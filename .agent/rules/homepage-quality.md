---
description: eval 包主页质量 rules seed——README 作为独立 repo 主页的可跑起点、代码-文档同 commit、规范不外包、无仓库外自我指涉、机器接线不入库；评审派遣时原样嵌入
---

# eval 包主页质量 rules

本文件是 `@catheadowl/dsh-eval`（dsh-plugin-dev/eval 树，含其 README、docs/
与发布面）主页质量目标的 **rules SSOT seed**，双端消费：生成时（经
`AGENTS.md` 指针加载）控制写作——advisory；评审时（review 技能的 dispatch
prompt **原样嵌入**本文件）对照，finding 引用 rule id。规则只写期望形态；
理由归认知层/决策史。id 一经评审/gate 引用即不改号；语义要变视同废弃换号；
作废标「已废弃」不复用。

- **HP-1〈quickstart-within-two-screens〉**：新读者从 README 顶部出发 ≤2 屏
  到达可跑起点；README 是独立 repo 主页，不是工作手册，超出该约束的内容
  归 `docs/`。探针：`pnpm verify:face` 部分覆盖（H1=包名、Install/
  Quickstart 存在性）；屏数判断无机械臂。基线：should-fix（主页定位错误
  升 blocker）。
- **HP-2〈code-docs-same-commit〉**：新增/变更公开导出与对应 `docs/` 文档
  同 commit 落地；归类与写法判断归评审。探针：`pnpm test`（verify:face 的
  发布文档集覆盖对账机械夹住覆盖缺口）。基线：should-fix。
- **HP-3〈no-outsourced-norms〉**：发布文档中的规范内容不外包给不发布的
  文档——按名引用只承载出处（npm 可查的包名、可模仿的 case 形态）；承载
  规范的引用要么内联，要么删。判据：读者拿到名字后能否行动。探针：无
  探针。基线：should-fix。
- **HP-4〈no-dev-repo-self-reference〉**：发布物（README/docs）内无仓库外
  自我指涉——流程阶段代号、内部工作流、其他仓库的内部结构指认都不进
  README/docs。探针：无探针（机械预扫 grep 命中仅供评审逐条裁决，见
  homepage-review 技能）。基线：对独立发布直接有害的泄露为 blocker，其余
  should-fix。
- **HP-5〈no-machine-wiring-committed〉**：junction / 本地 `file:` 等机器级
  接线不入库——接线是部署前提，修法进 `docs/host-wiring.md`，接线本身
  gitignore。探针：`pnpm verify:publish`（发布自检闸含 manifest/产物面
  规则）。基线：should-fix。

<!-- 覆盖自查：homepage-review 技能的非 judgment 维度（骨架/可懂性/泄露/
     分工）分别锚 HP-1、HP-1、HP-3+HP-4、HP-1+HP-3；视角正确性为本包
     judgment 维度（见豁免清单双读者条）。 -->

## intentional-design 豁免清单（防误报；finding 引用本清单即非 finding）

评审者注意：以下为刻意设计，不是缺陷——

- 对 npm 可查的包名、可模仿 case 形态的**按名引用**（纯文本、无路径）是
  接受的出处形态（HP-3/HP-4 豁免边界）；评审判的是噪音与否，不是「出现
  即违规」。
- README 面向双读者（消费者 + 维护者）是刻意选择——骨架/分工建议须尊重
  该前提再提优化。
- `docs/` 随包发布；`tests/` 与 `scripts/` 刻意不发布——发布面检查不以其
  内容为对象（其中的 fixture 字符串不算泄露）。

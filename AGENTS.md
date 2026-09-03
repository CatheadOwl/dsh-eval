---
description: eval 包维护规则——硬闸之外需判断力的部分：主页/文档分工律令、按名引用裁量、上游重查触发器、命令表与本文件的编辑规则
---

# dsh-plugin-dev/eval — 维护规则

`@catheadowl/dsh-eval` 是即将独立发布的 dsh 插件评测框架。硬规则由
`scripts/verify-package-face.mjs` / `verify-publish-readiness.mjs` 机械夹住
（随 `pnpm test` 跑，回归即红）：H1=包名、Install/Quickstart 存在、示例
import 不越包根、发布文档集覆盖全部 facade 导出、docs 链接自含、manifest
规则。本文件只放闸门管不了的判断规则。

## Commands

```sh
pnpm install            # file: 布局无 workspace；node ≥22
pnpm test               # 套件 + 两道发布闸（docs 自含 / import 覆盖 / manifest）
pnpm verify:publish     # 单跑发布自检闸
pnpm verify:face        # 单跑包面闸（含 docs 防漂移对账）
npm pack --pack-destination <隔离目录>   # 发布演练；prepack 自动过双闸
dsh-eval run <case>     # 消费者形态运行（配置见根 README）
```

真模型 case（real）需要凭证与可 spawn 子进程的运行面；mock 与 review
dry-run 不需要。宿主沙箱拒绝 spawn 时在宿主侧终端跑，不绕测试。

## 不变量（违反即错，无论上下文）

- **新读者 ≤2 屏到达可跑起点**——README 是独立 repo 主页，不是工作手册；
  违反该约束的内容属于 `docs/`。
- **代码与文档同 commit**——新增/变更公开导出必须同时落 `docs/`（闸门对
  账，但归类与写法归这里）。
- **规范内容不外包给不发布的文档**——按名引用只允许承载出处（npm 可查的
  包名、可模仿的 case 形态）；承载规范（读者必须知道才能用）的引用要么
  内联成规范，要么删。判据：读者拿到名字后能否行动。
- **发布物内无开发仓自我指涉**——流程阶段代号（"P4"之类）、本仓 agent
  工作流、源仓内部结构指认，都不进 README/docs（细节在
  `workunits/eval/review-evals/github-homepage-review.md` 的评审记录）。
- **机器级接线不入库**——junction / 本地 `file:` 是部署前提，修法进
  `docs/host-wiring.md`，接线本身 gitignore。

## 随上游变动的重查触发器

各篇的上游锚、触发事件与必查动作的 SSOT 在 [docs/AGENTS.md](docs/AGENTS.md)
（docs 作用域，在 docs/ 下工作会自动加载；不随包发布，见同目录 `.npmignore`）。
包级只留一条通则：**改了上游（宿主 / 源仓控制面 / facade / 方法论上游），
先查那张表再动手。**

## 流程规则

- README 主页结构性改动后，跑一轮 `workunits/eval/review-evals/`
  `github-homepage-review.md` 的派遣评审（协议内嵌于规格；机械验收）。
- 发布演练四步与验收判据：release-plan（`workunits/eval/release-plan/`）
  为 SSOT；真实 `npm publish` 后必须从 registry 重装复跑（发布物=验收物）。
- docs 以中文为主，README 保留英文定位句与「文档以中文为主」声明；新
  docs 文件带 frontmatter description（md-metadata 门禁）。

## Editing these instructions

`CLAUDE.md` symlink 本文件；改真身。规则保持自含，链高处文档；能机械化的
规则不写在这里——写进 `scripts/verify-*.mjs`。本文件超一屏时应先问哪条
规则该降级进闸门或升进 workunits，而不是加长。

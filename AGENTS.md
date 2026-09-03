---
description: eval 包维护规则——命令表、发布面不变量、发布/评审流程与本文件的编辑规则；只引用包内路径
---

# dsh-plugin-dev/eval — 维护规则

`@catheadowl/dsh-eval` 是 dsh 插件评测框架。硬规则由
`scripts/verify-package-face.mjs` / `verify-publish-readiness.mjs` 机械夹住
（随 `pnpm test` 跑，回归即红）：H1=包名、Install/Quickstart 存在、示例
import 不越包根、发布文档集覆盖全部 facade 导出、docs 链接自含、manifest
规则。本文件只放闸门管不了的判断规则。

## Commands

```sh
pnpm install            # node ≥22
pnpm test               # 套件 + 两道发布闸
pnpm verify:publish     # 单跑发布自检闸
pnpm verify:face        # 单跑包面闸（含 docs 防漂移对账）
npm pack --pack-destination <隔离目录>   # 发布演练；prepack 自动过双闸
dsh-eval run <case>     # 消费者形态运行（配置见根 README）
```

真模型 case（real）需要凭证与可 spawn 子进程的运行面；mock 与 review
dry-run 不需要。沙箱拒绝 spawn 时在宿主侧终端跑，不绕测试。

## 不变量（违反即错，无论上下文）

- **新读者 ≤2 屏到达可跑起点**——README 是独立 repo 主页，不是工作手册；
  违反该约束的内容属于 `docs/`。
- **代码与文档同 commit**——新增/变更公开导出必须同时落 `docs/`（闸门对
  账，归类与写法归这里）。
- **规范内容不外包给不发布的文档**——按名引用只承载出处（npm 可查的包
  名、可模仿的 case 形态）；承载规范的引用要么内联，要么删。判据：读者
  拿到名字后能否行动。
- **发布物内无仓库外自我指涉**——流程阶段代号、内部工作流、其他仓库的
  内部结构指认，都不进 README/docs。
- **机器级接线不入库**——junction / 本地 `file:` 是部署前提，修法进
  `docs/host-wiring.md`，接线本身 gitignore。

## 随上游变动的重查

各篇文档的上游锚与触发动作在 [docs/AGENTS.md](docs/AGENTS.md)（docs
作用域自动加载；不随包发布）。通则：**改了上游（dsh 宿主 / facade /
方法论来源），先查那张表再动手。**

## 流程规则

- README 主页结构性改动后，按 [.agents/homepage-review.md](.agents/homepage-review.md)
  派遣一轮主页评审（协议内含 dispatch 模板与机械验收）。
- 发布走四步：peer 闭包预检 → `npm pack` 干跑验内容 → 干净安装冒烟
  （tarball 安装 + 按 `docs/host-wiring.md` 接线 + 跑一条 mock case）→
  发布后从 registry 重装复跑。发布物 = 验收物。
- docs 以中文为主，README 保留英文定位句与「文档以中文为主」声明；新
  docs 文件带 frontmatter description（md-metadata 门禁）。

## Editing these instructions

`CLAUDE.md` 引用本文件；改真身。规则保持自含且**只引用包内路径**——本
文件随仓库走，包外路径拆仓即悬空。能机械化的规则写进
`scripts/verify-*.mjs`，不写在这里；超一屏时先降级/升维，不加长。

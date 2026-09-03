---
description: eval 包维护规则——命令表、发布面不变量、发布/评审流程与本文件的编辑规则；只引用包内路径
---

# dsh-plugin-dev/eval — 维护规则

`@catheadowl/dsh-eval` 是 dsh 插件评测框架。硬规则由
`scripts/verify-manifest-face.mjs` / `verify-publish-readiness.mjs` 机械夹住
（两脚本是托管副本，跨消费者逐字节一致，包参数在
`scripts/verify.config.mjs`；不直接改副本——仓级对账 gate
`gate-blueprint-drift` 会拦截，规则变更在范本侧完成后推贯；随
`pnpm test` 跑，回归即红）：H1=包名、Install/Quickstart 存在、示例
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

rules SSOT seed 在 [.agent/rules/homepage-quality.md](.agent/rules/homepage-quality.md)（评审派遣时原样嵌入，finding 引用 rule id）。

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

规则保持自含且**只引用包内路径**。能机械化的规则写进`scripts/verify-*.mjs`，不写在这里；超一屏时先降级/升维，不加长。

---
description: eval 包维护规则——README/docs 主页与文档分工、按名引用裁量、随上游变动的更新义务；硬闸之外需判断力的部分在此
---

# dsh-plugin-dev/eval — 维护规则

本包即将独立发布。硬性规则由 `scripts/verify-package-face.mjs` /
`verify-publish-readiness.mjs` 机械夹住（随 `pnpm test` 跑，回归即红）：H1 =
包名、Install/Quickstart 存在、示例 import 不越包根、发布文档集覆盖全部
facade 导出、docs 链接自含、manifest 规则。**以下是闸门管不了、需要判断力
的维护规则。**

## README / docs 分工（主页 vs 深度契约）

- README 是独立 repo 主页：定位（是什么/不是什么）→ Install → Quickstart →
  规范目录 → config → docs 索引。**新读者 ≤2 屏到达可跑起点**是硬约束。
- 深度契约（matcher 全集、边界契约、报告 schema、运维前提、known-issues）
  一律进 `docs/`，并在 `docs/README.md` 索引登记。
- 新增公开导出（matcher/helper/API）必须**代码 + 文档同 commit**——闸门会对
  账，但归类（matchers 还是 review 篇）与写法是这里的事。
- 主页结构性改动后跑一轮
  `workunits/eval/review-evals/github-homepage-review.md` 的评审（协议在
  该规格内，subagent 派遣 + 机械验收）。

## 按名引用的「出处 vs 噪音」裁量

发布文档允许**按名**引用包外证据（`@catheadowl/dsh-extras` 的 row id 权威、
`coggit`/`md-rename` 范例），判据：

- **出处型（保留）**：读者拿到名字后能行动（npm 可查的包名、可模仿的 case
  形态）；
- **噪音型（删除）**：需要本开发仓内部知识才能解码的指认（模块内部结构、
  流程阶段代号、「见某文档集」但该文档不随包发布且不公开）。
  委托不发布文档承载**规范内容**是禁止的——要么内联成规范，要么删。

## 随上游变动的更新义务（重查触发器）

| 文档 | 上游锚 | 何时必须重查 |
|---|---|---|
| `docs/host-wiring.md` | dsh CLI 依赖闭包、`dsh-llm` registry dist-tags | 宿主发新版 / peer 集变更 / `@deepseek-ai/dsh-llm` 有新 dist-tag 时 |
| `docs/known-issues.md` | 源仓 TODO「staged-home-request-extension」等条目 | 对应宿主插件改版、或源仓 TODO 状态变化时（修了就删条，别留僵尸） |
| `docs/matchers.md` | `src/index.mjs` facade | 加导出即改（闸门强制）；语义变更即改描述 |
| `docs/intent-cases.md` | 意图面 e2e 方法论（「agent-tools-dev / 01-意图面-e2e」，不随包发布） | 上游触发表/失败启发集演进时同步内联版——本文的表是**规范版**，不是摘要 |
| 宿主 seam 断言（退出语义、JSONL 布局、overlay 顺序） | explorer「eval-seams」证据集（开发仓） | 宿主 seam 源码演进时先查证据层行号是否漂移，再动引用它的文档 |

## 本包特有约定

- `tests/`、`scripts/` 不进 tarball（`files` 白名单）；环境自证走真实 mock
  case 冒烟，不靠随包测试套件。
- docs 以中文为主，README 保留英文定位句与「文档以中文为主」声明。
- 新 docs 文件带 frontmatter description（md-metadata 门禁）。
- 机器级接线（dsh-llm junction 等）不入库；修接线的方法进 `docs/host-wiring.md`。

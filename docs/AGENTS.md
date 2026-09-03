---
description: docs/ 维护规则——各篇的上游重查触发器、写作约定与评审协议入口（本文件面向仓库维护者，不随包发布，见同目录 .npmignore）
---

# dsh-plugin-dev/eval/docs — 维护规则

本目录七篇是 `@catheadowl/dsh-eval` 的**发布文档集**（随 `files` 进
tarball）。写作不变量在包根 `AGENTS.md`（≤2 屏主页约束、代码+文档同
commit、规范不外包给不发布的文档）；本文件管**每篇的上游锚**与目录内
约定。

## 各篇的上游重查触发器（改对应上游时必查本表）

| 篇 | 上游锚 | 触发事件 → 动作 |
|---|---|---|
| `host-wiring.md` | dsh CLI 依赖闭包、`@deepseek-ai/dsh-llm` registry dist-tags | 宿主发新版 / peer 集变更 / 新 dist-tag → 重跑闭包预检，更新三形结局与古董版本号 |
| `known-issues.md` | 源仓控制面的 TODO 条目（如「staged-home-request-extension」） | 源仓 TODO 状态变化 → 修了就删条，不留僵尸；新增已知问题先在源仓登记再入篇 |
| `matchers.md` | `src/index.mjs` facade | 加导出即改（package-face 闸强制）；语义变更即改描述与分类（工具面/文本面/输入面） |
| `intent-cases.md` | 意图面 e2e 方法论（上游手册「01-意图面-e2e」） | 上游触发表/失败启发集演进 → 同步内联表——本篇的表是**规范版**，不是摘要 |
| `review.md` / `disablerows.md` / `report.md` | 本包框架源码 | 契约变更同 commit 更新（闸门对账 facade 导出；CLI flags 变更查 review/report 两篇） |
| 全篇涉及的宿主 seam 断言（退出语义 / JSONL 布局 / overlay 顺序） | 开发仓 explorer「eval-seams」证据集 | 宿主 seam 源码演进 → 先查证据层是否漂移，再动引用它的文档 |

## 目录约定

- 新篇进 `README.md` 索引表；带 frontmatter description（md-metadata 门禁）。
- 篇间互链用相对路径；发布闸拦一切越出包根的链接与路径 token。
- 语义级"出处 vs 噪音"裁量不归机械闸（已回滚的教训：机械门只拦可分离
  形态）——拿不准时跑包根 AGENTS.md 指向的主页评审协议。

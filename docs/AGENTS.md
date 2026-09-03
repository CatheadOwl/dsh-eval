---
description: docs/ 维护规则——各篇的上游重查触发器与目录内写作约定（本文件面向仓库维护者，不随包发布，见同目录 .npmignore）
---

# dsh-plugin-dev/eval/docs — 维护规则

本目录是 `@catheadowl/dsh-eval` 的**发布文档集**（随 `files` 进 tarball）。
写作不变量在包根 `AGENTS.md`（≤2 屏主页约束、代码+文档同 commit、规范
不外包）；本文件管**每篇的上游锚**与目录内约定。

## 各篇的上游重查触发器（改对应上游时必查本表）

| 篇 | 上游锚 | 触发事件 → 动作 |
|---|---|---|
| `host-wiring.md` | dsh CLI 依赖闭包、`@deepseek-ai/dsh-llm` registry dist-tags | 宿主发新版 / peer 集变更 / 新 dist-tag → 重跑闭包预检，更新三形结局与古董版本号 |
| `known-issues.md` | 本包问题跟踪中的对应条目（按名对齐） | 上游修复落地 → 删条不留僵尸；新增已知问题先登记再入篇 |
| `matchers.md` | `src/index.mjs` facade | 加导出即改（package-face 闸强制）；语义变更即改描述与分类（工具面/文本面/输入面） |
| `intent-cases.md` | 意图面 e2e 方法论（上游手册，按名引用） | 触发表/失败启发集演进 → 同步内联表——本篇的表是**规范版**，不是摘要 |
| `review.md` / `disablerows.md` / `report.md` | 本包框架源码 | 契约变更同 commit 更新（闸门对账 facade 导出；CLI flags 变更查 review/report 两篇） |
| 全篇涉及的宿主 seam 断言（退出语义 / JSONL 布局 / overlay 顺序） | dsh 宿主源码（vendored 检出） | 宿主 seam 源码演进 → 先对宿主源码重新验证断言，再动引用它的文档 |

## 目录约定

- 新篇进 `README.md` 索引表；带 frontmatter description（md-metadata 门禁）。
- 篇间互链用相对路径；发布闸拦一切越出包根的链接与路径 token。
- 语义级"出处 vs 噪音"裁量不归机械闸（机械门只拦可分离形态）——拿不准时
  跑包根 `AGENTS.md` 指向的主页评审协议（`.agents/homepage-review.md`）。

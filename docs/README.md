---
description: dsh-eval 文档索引——安装与宿主接线、review、matcher 全集、disableRows/rowConfig 契约、intent case 规约、报告结构与已知问题的路由表
---

# dsh-eval · docs index

| 文档 | 主题 |
|---|---|
| [host-wiring.md](host-wiring.md) | 安装与宿主接线：peer 依赖（dsh-llm）、构建 CLI、profile、凭证、spawn 要求 |
| [review.md](review.md) | comprehension review：实验定义、空白环境 reviewer、产物清单、六条评审规则 |
| [matchers.md](matchers.md) | trace matcher 与 mock helper 全集 |
| [disablerows.md](disablerows.md) | `disableRows` 与 turn-close 门禁边界契约 |
| [rowconfig.md](rowconfig.md) | `rowConfig` 行 config 覆写契约（整段替换语义、形状限制、与 disableRows 分工） |
| [intent-cases.md](intent-cases.md) | real 意图 case 规约：何时写、断言面、守卫、CI 语义 |
| [report.md](report.md) | 机器可读报告（`--format json` / `--report`）结构 |
| [runner-api.md](runner-api.md) | 程序化 runner API：`runEvalCase` options 契约、EvalRunResult 字段、跨档取 `cliPath` |
| [known-issues.md](known-issues.md) | 已知问题与规避 |
| [experimental.md](experimental.md) | `experimental` 子路径符号清单（逃生面，无兼容承诺） |

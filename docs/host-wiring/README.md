---
description: Host wiring index — install, the three host dependency faces (peer, CLI, environment), the quick wiring path, and the topic routing table
---

# 安装与宿主接线

`@catheadowl/dsh-eval` 是 dsh 生态的开发期工具：驱动真实 dsh headless 会话评测 dsh 插件，对宿主有三类依赖——**包管理面**（peer 依赖 `@deepseek-ai/dsh-llm`）、**运行面**（构建好的 dsh CLI）、**环境面**（profile 与凭证）。本页承载安装与快速接线路径；各面的契约、事实与排查分述于主题页，见底部索引。

## Install

```bash
npm i -D @catheadowl/dsh-eval
# 或 pnpm add -D @catheadowl/dsh-eval
```

安装后 `node_modules/.bin` 提供两个 CLI：`dsh-eval`（behavior case）与 `dsh-review`（comprehension review）。

## 快速接线路径

1. 宿主来源：与 `@deepseek-ai/dsh` 同装（`npm i -D @deepseek-ai/dsh @catheadowl/dsh-eval`）时 peer 由宿主依赖树满足，零接线——此为推荐形态（2026-10-26 实测，冷装宿主勿带 `--legacy-peer-deps`）。未同装宿主时才需接通 [dsh-llm peer](peer-resolution.md)。缺包与古董版本都会使 case 失败；古董版本（npm 自动安装的 registry `latest` 副本，仅在宿主不在安装树时出现）症状更隐蔽。
2. 确保 [dsh CLI 可定位](cli-resolution.md)。三层解析链，先命中者生效；三层全缺时 fail-loud。
3. 被测插件装进所选 profile：`dsh plugin --profile <profile> add <插件目录>`。

每条 behavior case 在隔离的临时 `DSH_HOME` 与 workspace 中启动 dsh，session JSONL 经 `--patch` 定向到本次 run，不写真实 profile store。review 默认空白环境：任意 profile 均可，树外插件行由 overlay 枚举禁用（见 [review.md](../review.md)）。暂存面**不覆盖**的环境性表面（用户技能目录等漏入通道）与混杂控制方法见 [environment.md](../environment.md)——接线只决定拷什么，覆盖边界是实验设计的事。

## spawn 要求

real case 以管道 stdio spawn 子 dsh CLI（headless 会话、子代理子运行时），需要可 spawn 子进程的运行面；受限沙箱可能拒绝（`spawn EPERM`），此时在宿主侧终端 / CI 运行。mock 与 review dry-run 不 spawn 子 CLI，无此约束。

## 主题索引

| 主题 | 页 |
|---|---|
| dsh-llm peer 接线契约：三形结局、junction 修法、自诊断 | [peer-resolution.md](peer-resolution.md) |
| dsh CLI 定位链与构建要求 | [cli-resolution.md](cli-resolution.md) |
| 宿主契约断言：session seam 五处硬断言 + LLM adapter 线上契约 | [host-contracts.md](host-contracts.md) |
| 模型选择：real 模型来源链、常见误判、钉版做法 | [model-selection.md](model-selection.md) |
| 凭证：解析归属、成立条件、profile patch | [credentials.md](credentials.md) |

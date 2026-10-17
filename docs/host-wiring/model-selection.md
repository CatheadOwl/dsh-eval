---
description: Model selection for real runs — the profile-composed agent-default-model chain, the two common misreadings, and the three pinning scopes
---

# 模型选择

real 层的模型配置面**全在 dsh profile，本包零模型知识**：runner 与 review executor 都不传模型参数，生成的 overlay 也不碰模型行。实际模型 = 所启动 profile 各层（bundle 链 + profile patch + 本次 eval overlay）合成的 `agent-default-model` loader 行——宿主一发式 headless runner 与本包多轮 driver（`src/driver/multi-turn-driver.mjs`）都经 `agentDefaultModel` 服务的 `currentSelection()` 读它；review 的空白环境同样保留该行（`src/adapters/dsh/review.mjs` 的 `REVIEW_REQUIRED_ROWS`）。profile 不覆写该行时，即 bundle 链的出厂默认（典型为 dsh-base 默认，随宿主演进而变）。

两个常见误判：

- **eval 的模型不等于交互会话的当前选择**。每条 case 的暂存 home 只复制 profile store 与托管凭证文档（`stageSandboxHome`），不含 `$DSH_HOME/settings.yaml`——交互 / web 会话的模型选择与多 provider 配置（`llm-deepseek:` / `llm-pi-ai:` settings 节）住在那里，不进 eval。eval 的模型严格等于 profile 行配置。
- **默认不钉版本**。profile 继承 base 默认时，宿主改 base 默认，下次 run 的模型随之变更且无提示。核对某次 run 实际使用的模型：`--keep-artifacts` 落盘的 session 日志里第一个 `request/header` 事件的 `data.header.config.provider/model` 是权威证据（机器可读报告不携带模型字段）。

钉住模型，按作用面三选一：

| 做法 | 作用面 | 说明 |
|---|---|---|
| profile patch 覆写 `agent-default-model` 行 | 该 profile 的全部 run（含正常使用） | `- id: agent-default-model` + `config` 里重述 `provider` / `model`（dsh patch 整段替换语义） |
| case 级 `rowConfig: { 'agent-default-model': { provider, model } }` | 单条 case | 见 [rowconfig.md](../rowconfig.md)；该行仅这两个键，重述即完整 |
| `mode: 'mock'` | 单条 case | overlay 强制 `provider` / `model` 为 `eval-mock`（见 [host-contracts.md](host-contracts.md) 的 mock adapter 契约），与真实模型无关 |

前提：所选 provider 路由须在启动 composition 中已注册。出厂仅 `deepseek-official` 一个活跃路由；`llm-pi-ai` 多 provider 适配器默认 dormant、靠 settings 文档的 `llm-pi-ai:` 节激活——而 settings 不进暂存 home，所以非 DeepSeek 路由需要 profile 自带注册该 provider 的插件行（mock 的 `eval-mock-llm` overlay insert 就是这个形状的先例）。

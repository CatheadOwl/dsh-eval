---
description: Known issues with failure shapes and row-level mitigations — REQUEST_EXTENSION on real cases in staged homes (row-set scoping data in entry) and dsh-review spawn EPERM under the file sandbox
---

# 已知问题

## real case 在 staged home 下 `REQUEST_EXTENSION` 失败（未解）

**症状**：real behavior case 在暂存临时 `DSH_HOME` 里，首个模型调用即报 `REQUEST_EXTENSION` 类失败；mock 不受影响。

**嫌疑**：宿主的 `plugin-package-inventory-deepseek` 插件 × staged 环境的包身份解析（staging 复制的 profile 让该插件的清单收集失败）。

**范围数据（2026-10-27 消费方回投）**：最小三 bundle 形态（`dsh-base` + `dsh-headless` + 树外 bundle）+ 第三方 provider 桥 patch 的 real run **未复现**、免兜底跑通——该形态下嫌疑行多半不在场（推断，未逐行核对），反例与嫌疑不矛盾，但把触发面收窄到行集更全的 profile 形态。后续复现请附 profile 行集与 provider 路由，便于定位到行。

**框架侧兜底**：case 或 config 声明 `disableRows: ['plugin-package-inventory-deepseek']` 按行禁用该插件（机制见 [disablerows.md](disablerows.md)）。

**追踪**：上游修复落地即删本条（不留僵尸条目）。

## DSH file sandbox 下 `dsh-review` spawn headless 子进程 `EPERM`（未解）

**症状**：在 DSH file sandbox（受限运行面）内运行 `dsh-review`，首次 spawn headless 子进程即报 `spawn EPERM`，escalated retry 后可运行。

**定性**：沙箱运行面约束，非框架缺陷——沙箱拒绝 spawn 时换宿主侧终端或升级运行面即可（与本包维护规则「沙箱拒绝 spawn 时在宿主侧终端跑，不绕测试」同族）。登记供沙箱内调用方知晓。

**追踪**：开发侧状态板按名登记为「2026-09-06 · dsh-review 沙箱 spawn EPERM 已知约束」（按名对齐）；运行面行为变化时同删。

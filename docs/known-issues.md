# 已知问题

## real case 在 staged home 下 `REQUEST_EXTENSION` 失败（未解）

**症状**：real behavior case 在暂存临时 `DSH_HOME` 里，首个模型调用即报
`REQUEST_EXTENSION` 类失败；mock 不受影响。

**嫌疑**：宿主的 `plugin-package-inventory-deepseek` 插件 × staged 环境的
包身份解析（staging 复制的 profile 让该插件的清单收集失败）。

**框架侧兜底**：case 或 config 声明
`disableRows: ['plugin-package-inventory-deepseek']` 按行禁用该插件
（机制见 [disablerows.md](disablerows.md)）。

**追踪**：登记于本包源仓的 TODO「staged-home-request-extension」（按名可
检索）。

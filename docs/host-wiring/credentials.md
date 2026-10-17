---
description: Credentials for real runs — what this package does, the host-owned resolution facts restated, and the profile patch that makes the managed store readable
---

# 凭证

real 层的**模型凭证由 dsh 自行解析**，本包的凭证面只有三件事：spawn dsh 本体、env 原样透传；真实 home 的托管凭证文档（`.credentials.yaml`）经 `stageSandboxHome` 复制进暂存 home——中性暂存，读不读由启动的组合决定；启动前的存在性探测（env 或托管文档任一可见即不 auto-skip），只判可见性、不判可解析性。

其余是宿主组合面的事实（dsh / dsh-headless 所有，非本包行为），在此重述以校准预期：

- dsh 的凭证解析两级：组合加载 `dsh-credentials-local` 时，`apiKeyEnv` 引用按其优先级逐请求解析（存储文件优先，env 后备）；未加载时只读启动环境。
- `dsh-headless` bundle 默认禁用 credentials 行，原生 headless profile 因此只认启动环境。

据此，real case 与交互会话同为可运行的条件是：key 由 env 供给，或 profile 组合启用了 credentials 行（库存 key 随行）。key 只在托管文档里而组合未加载读取者时，探测不 skip，case 以 `MISSING_CREDENTIAL` 结束——失败面在组合的凭证解析，不在本包。

要让托管文档生效，走 profile patch（宿主的组合扩展点，不是本包配置），单行、机器级生效：

```yaml
- id: credentials
  name: "@deepseek-ai/dsh-credentials-local"
  disabled: false
```

真实 home 没有托管凭证文档的机器（典型为 CI）不受影响：staging 对缺失文档不复制，走 env。mock 与 review dry-run 不需要凭证。

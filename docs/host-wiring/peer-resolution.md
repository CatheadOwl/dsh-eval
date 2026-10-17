---
description: dsh-llm peer wiring — the three consumer-side resolution outcomes, the junction fix, and self-diagnostics
---

# peer 接线：`@deepseek-ai/dsh-llm`

本包声明 `peerDependencies: { "@deepseek-ai/dsh-llm": "*" }`：运行时由 dsh 宿主生态提供，包自身不携带。消费态解析有三种结局：

1. **缺包形**（pnpm `file:` 安装态）：mock case 报 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm'`，`imported from` 锚在 `node_modules/.pnpm/@catheadowl+dsh-eval.../` 内。上溯链止于虚拟 store 是该契约的特征指纹，不是本包缺陷。
2. **古董 peer 形**（npm 安装态，更难排查）：npm ≥7 自动安装 peerDependencies，而 `@deepseek-ai/dsh-llm` 的 registry `latest` dist-tag 停在 `0.0.1-rc.1`，与宿主现行 API 不兼容。症状：boot 报 `dsh: UNKNOWN: registration.adapter.prepareCall is not a function`，case exit 1、无 assistant 文本。
3. **正确形**：`node_modules/@deepseek-ai/dsh-llm` 为指向宿主 checkout 内对应包的目录链接（Windows junction），或安装时 `--legacy-peer-deps` 阻止自动安装后再接。

**接线步骤**（消费者根目录，Windows）：

```powershell
Remove-Item -Recurse -Force node_modules\@deepseek-ai\dsh-llm   # 若被自动装了
New-Item -ItemType Junction -Path node_modules\@deepseek-ai\dsh-llm `
  -Target <dsh checkout>\apps\cli\node_modules\@deepseek-ai\dsh-llm
```

**自诊断**：

```bash
node -e "import('@deepseek-ai/dsh-llm').then(() => console.log('ok'), e => console.log(e.code))"
node -e "console.log(require('./node_modules/@deepseek-ai/dsh-llm/package.json').version)"
```

第一条打印 `ok` 即解析链通；第二条核对版本，`0.0.1-rc.1` 即 registry 古董副本，按上节替换。接线是机器相关的部署前提，不入库（gitignore 或本地脚本承接）。

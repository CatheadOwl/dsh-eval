---
description: dsh-llm peer wiring — the default host-coinstall form needs zero wiring; the three consumer-side resolution outcomes and when each applies; self-diagnostics
---

# peer 接线：`@deepseek-ai/dsh-llm`

本包声明 `peerDependencies: { "@deepseek-ai/dsh-llm": "*" }`：运行时由 dsh 宿主生态提供，包自身不携带。

**默认形态零接线（2026-10-26 实测）**：与宿主同装——`npm i -D @deepseek-ai/dsh @catheadowl/dsh-eval`——时，宿主依赖树自带同代 `dsh-llm`（0.2.x，经宿主包依赖边入树、dedupe 单实例），peer 已满足，npm 不会另拉 registry 副本。评测机即两行安装；profile 用自带模板（如 `--profile headless`），在隔离 `DSH_HOME` 自动物化，mock case 即可跑通。

消费态解析的三种结局（按形态对号）：

1. **缺包形**（pnpm `file:` 安装态、或裸装本包且宿主不在树）：mock case 报 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm'`，`imported from` 锚在 `node_modules/.pnpm/@catheadowl+dsh-eval.../` 内。上溯链止于虚拟 store 是该契约的特征指纹，不是本包缺陷。处置 = 改两行同装形，或按下节接线。
2. **古董 peer 形**（npm 安装态且宿主不在树，更隐蔽）：npm ≥7 自动安装 peerDependencies，裸装本包时从 registry 拉 `latest`——`@deepseek-ai/dsh-llm` 的 `latest` 停在 `0.0.1-rc.1`，与现行宿主 API 不兼容。症状：boot 报 `dsh: UNKNOWN: registration.adapter.prepareCall is not a function`，case exit 1、无 assistant 文本。**两行同装形不会落入此形**（宿主树副本满足 peer 在先）。
3. **正确形**：`node_modules/@deepseek-ai/dsh-llm` 为同代副本——两行同装形的默认结局；或 checkout 钉定开发形态下手工 junction 指向宿主检出对应包。

**接线步骤**（仅「宿主不在树」的形态需要；消费者根目录，Windows）：

```powershell
Remove-Item -Recurse -Force node_modules\@deepseek-ai\dsh-llm   # 若被自动装了古董副本
New-Item -ItemType Junction -Path node_modules\@deepseek-ai\dsh-llm `
  -Target <dsh checkout>\apps\cli\node_modules\@deepseek-ai\dsh-llm
```

**脚枪**：冷装宿主（`npm i @deepseek-ai/dsh`）时**勿带 `--legacy-peer-deps`**——宿主家族的运行时依赖声明在导入方 `peerDependencies`，npm ≥7 靠自动装 peer 补齐；该旗关闭自动装后宿主自身 import 即死、插件激活全灭（机制与实测见 explorer plugin-dep-resolution registry-trap claim 6）。

**自诊断**：

```bash
node -e "import('@deepseek-ai/dsh-llm').then(() => console.log('ok'), e => console.log(e.code))"
node -e "console.log(require('./node_modules/@deepseek-ai/dsh-llm/package.json').version)"
```

第一条打印 `ok` 即解析链通；第二条核对版本——两行同装形应为宿主同代（如 `0.2.1-rc.2`）；`0.0.1-rc.1` 即裸装态拉到的 registry 古董副本，卸掉后改两行同装或按上节接线。接线是机器相关的部署前提，不入库（gitignore 或本地脚本承接）。

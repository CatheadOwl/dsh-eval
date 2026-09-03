---
description: 安装与宿主接线——dsh-llm peer 的三形解析结局与 junction 步骤、构建 CLI 与 profile/凭证/spawn 三类运行前置
---

# 安装与宿主接线

`@catheadowl/dsh-eval` 是 dsh 生态的开发期工具：它驱动真实 dsh headless 会话来评测 dsh 插件，因此对宿主有三类依赖——包管理面（peer）、运行面（构建好的 dsh CLI）、环境面（profile 与凭证）。

## Install

```bash
npm i -D @catheadowl/dsh-eval
# 或 pnpm add -D @catheadowl/dsh-eval
```

装好后 `node_modules/.bin` 里出现两个 CLI：`dsh-eval`（behavior case）与 `dsh-review`（comprehension review）。

## peer 依赖：`@deepseek-ai/dsh-llm` 的接线契约

本包声明 `peerDependencies: { "@deepseek-ai/dsh-llm": "*" }`——运行时由 dsh 宿主生态提供，包自身不携带。消费态解析有**三形结局**：

1. **缺包形**（pnpm `file:` 安装态）：mock case 报 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm'`，`imported from` 锚在 `node_modules/.pnpm/@catheadowl+dsh-eval.../` 内——上溯链止于虚拟 store 是本契约的特征指纹，不是本包缺陷。
2. **古董 peer 形**（npm 安装态，更隐蔽）：npm ≥7 会**自动安装 peerDependencies**，而 `@deepseek-ai/dsh-llm` 的 registry `latest` dist-tag 停在 `0.0.1-rc.1`——与宿主现行 API 不兼容。症状：boot 报 `dsh: UNKNOWN: registration.adapter.prepareCall is not a function`，case exit 1、无 assistant 文本。装了错版本比没装更难排查。
3. **正确形**：把 `node_modules/@deepseek-ai/dsh-llm` 替换为指向宿主 checkout 内对应包的目录链接（Windows junction），或安装时 `--legacy-peer-deps` 阻止自动装后再接。

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

第一条打印 `ok` = 解析链通；第二条核对版本——若为 `0.0.1-rc.1` 即 registry 古董副本，按上节替换。接线是机器相关的部署前提，不入库（gitignore 或本地脚本承接）。

## 运行面：构建好的 dsh CLI

dsh CLI 的定位按以下顺序，先中先得：

1. **显式 flag**：`--repo <host-checkout>`（检出须已构建，`apps/cli/lib/bin.js` 存在）；
2. **解析层**：`node_modules/@deepseek-ai/dsh/lib/bin.js`（开发态由 junction 指到宿主检出，可用 relink 脚本从机器级 `DSH_REPO` 锚点重建；消费态由安装树提供）；
3. **config `repo` 键**：legacy，已从各包入库 config 退役。

三层全缺时 fail-loud（报错含占位符修法指引）。自诊断：

```bash
node -e "console.log(require('fs').existsSync('node_modules/@deepseek-ai/dsh/lib/bin.js'))"
```

`false` = 解析层缺 CLI：先跑 relink 重建 junction；仍 `false` 则宿主检出未构建（先构建宿主）。behavior 与 review 的真实运行都从定位到的 CLI spawn dsh 本体。

## 环境面：profile 与插件安装

- 被测插件须已装进所选 profile：`dsh plugin --profile <profile> add <插件目录>`；
- 每条 behavior case 在隔离的临时 `DSH_HOME` 与 workspace 中启动 dsh，通过 `--patch` 把 session JSONL 定向到本次 run——不污染真实 profile store；
- review 使用专用 sterile profile（详见 [review.md](review.md)）。

## 凭证

real 层的**模型凭证由 dsh 自行解析**——spawn 的是 dsh 本体，env 原样透传，真实 home 的托管凭证文档（`.credentials.yaml`）会被复制进暂存 home；**你的 dsh 能正常跑，real case 就能跑**。本包不做任何凭证配置，只在启动前做存在性探测（env 或托管文档任一可见）以决定 real case 是否 auto-skip。mock 与 review dry-run 完全不需要凭证。

## spawn 要求

real case 会以管道 stdio spawn 子 dsh CLI（headless 会话、子代理子运行时），因此需要一个能 spawn 子进程的运行面——受限沙箱里可能被拒（`spawn EPERM`），此时在宿主侧终端 / CI 跑即可。mock 与 review dry-run 不 spawn 子 CLI，无此约束。

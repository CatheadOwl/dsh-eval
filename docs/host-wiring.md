---
description: 安装与宿主接线——dsh-llm peer 的三形解析结局与 junction 步骤、构建 CLI 与 profile/凭证/spawn 三类运行前置、本包对宿主 session seam 的五处硬断言及其执法面（artifact 代际命名 / header 代际戳 / 拼接帧容器 / snapshotEvents 读取面 / v3 system prompt 面事件），以及 mock 模式依赖的宿主 LLM adapter 线上契约（prepareCall，自带覆写对 peer 实例代差免疫）。
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
2. **解析层**：`node_modules/@deepseek-ai/dsh/lib/bin.js`（开发态由 junction 指到宿主检出，junction 失效时须重建为指回本地宿主检出；消费态由安装树提供）；
3. **config `repo` 键**：legacy，已从各包入库 config 退役。

三层全缺时 fail-loud（报错含占位符修法指引）。自诊断：

```bash
node -e "console.log(require('fs').existsSync('node_modules/@deepseek-ai/dsh/lib/bin.js'))"
```

`false` = 解析层缺 CLI：先把上述 junction 重建为指向宿主检出；仍 `false` 则宿主检出未构建（先构建宿主）。这类 junction 维护是机器相关的开发环境事务，不入库，由各开发环境自行承接（同上文 peer 接线的 gitignore 纪律）。behavior 与 review 的真实运行都从定位到的 CLI spawn dsh 本体。

## 宿主 session seam：本包硬断言的五处，坏了多是具名失败

behavior 与 review 的证据都取自**真实 dsh 会话的产物与进程内日志**，因此本包直接断言宿主的几处 session seam。它们随宿主演进时不会有编译期提示，所以每一处都配一行**执法面**（表里的符号就是）；宿主检出更新后、动本包引用它们的文档前，先按本节对源码重新验证：

| 断言 | 宿主依据 | 本包执法面 | 坏了长什么样 |
|---|---|---|---|
| 会话 artifact 按**格式代**命名：v0 是 `session.jsonl`，之后每代带小写数字（当前 `session.v3.jsonl`）；`compression: none` 时无 `.zstd` 后缀 | `session-persistence-jsonl/src/format.ts` 的 `generationLogFilename`，配 `core/session/src/types.ts` 的 `SESSION_FORMAT_VERSION` | `isSessionLogFilename`（命名判定）+ `collectSessionTrace`（收集）⇒ behavior 失败文案 / review 记账里的 `traceGap` | 只按 v0 名收集 ⇒ 一条日志都收不到；失败文案列出**实际扫到的候选文件名**并写明「宿主 artifact 命名可能已换代」，不再只报 `no session trace materialized` |
| 会话 header 的 `version` 戳是宿主对逻辑代际的声明（当前 v3） | 同上；已发布的代际链见 `session-format-catalog/src/generated.ts`（codecs v0–v3、`currentVersion: 3`） | `KNOWN_SESSION_FORMAT_VERSIONS`（`parseSessionLog` 入口准入，**仅 v3**——旧代际同样拒绝，不留旧格式兼容） | 非本代际（旧或未知）⇒ 解析当场拒绝并报出版本号（`session header version vN is not a known generation`），不再把各投影字段静默降级成空数组 |
| 会话日志是**拼接帧容器**（宿主默认 zstd），须逐帧扫描 | `session-persistence-jsonl/src/zstd.ts` 的帧扫描 | eval overlay 固定 `compression: none` + `packChunks: false`（`src/overlay.mjs`） | 整文件一次解压 ⇒ `ZSTD_error_prefix_unknown`（第二帧魔数被当输入） |
| 进程内读 durable 事件的 API 是 `Session#snapshotEvents()`（不可变冻结快照）；早期的 `session.events` getter 已被删除 | `core/session/src/index.ts` 的 `snapshotEvents` | driver 行（`src/driver/multi-turn-driver.mjs`）直接调用，没有回退路径 | 属性访问得到 `undefined` ⇒ 进程内消费者抛 `agent.session.events is not iterable`，整个 headless run 直接死 |
| v3 起组装后 system prompt 落 `system/message` **面事件**（流式：append 加节点、replace 换节点；首请求必 commit 节点 0，即使 prompt 为空），`request/header` **不再带** `system` 字段；有效 prompt = 存活节点中最后一个非空 | `core/agent-loop/src/runtime-context.ts` 的 `SystemPromptProjection`（首请求必 commit）+ `core/session/src/surface.ts` 的面折叠 + `core/session/src/types.ts` 的 `EpochHeader`（无 system）+ `session-format-v2-to-v3/src/migration.ts`（streaming system-prompt promotion） | `buildTrace` 的 system/message 面 fold + `systemMessages` / `systemPrompt` 投影 + census `promptSurfaceAbsent`（`src/trace.mjs`）；`systemPromptIncludes` 渠道空置响亮失败 | 投影只读 header.system（曾是的 v3 前形状）⇒ v3 日志上 `systemPromptIncludes` 恒 false（coggit treatment 臂 10/10 守卫全败形态），census 逐 run 记 `promptSurfaceAbsent` |

命名行与代际行的读取面由本包的 eval overlay 固定（`compression: none` + `packChunks: false`），所以每轮 run 的 artifact 是**明文逐事件**布局；命名判定、代际准入与收集入口都在 `src/trace.mjs`（`isSessionLogFilename` / `KNOWN_SESSION_FORMAT_VERSIONS` / `collectSessionTrace`），behavior runner 与 review adapter 共用同一个收集入口，缺 artifact 时各自把 `traceGap` 带进失败文案与产物记账。帧容器行走 overlay 固定；倒数第二行是 driver 行读日志时直接依赖的方法；末行是投影读 prompt 面的入口。

> **维护触发器**：宿主 session 格式、持久化命名或 `Session` 读取面变更 ⇒ 先按上表对 vendored 检出重新验证断言，再更新本篇与引用它们的源码/认知。前两行现在是**机械的**——命名或代际戳变了，跑一条 case 就红在具名文案上（候选文件名 / 版本号）；其余三行仍只有真跑一条 case 才会暴露。

### 宿主 LLM adapter 线上契约（mock 模式专用）

mock 模式经 `eval-mock-llm` 插件（`src/mock/mock-adapter.mjs`）注册 `EvalMockAdapter`，它 `extends` 的 `LlmAdapter` 基类解析自**本包的 peer 实例**——该实例可以落后于驱动它的宿主运行时（实测：宿主 0.1.5-rc.2 的 LLM 服务对已注册 adapter 新增 `registration.adapter.prepareCall(...)` 调用面时，本地 peer 还是 0.0.1-rc.1，继承面缺失，全部 mock run 死在启动期）。因此适配器**自带** `prepareCall` 覆写、不依赖继承面在不在：形状镜像宿主基类默认契约（`PreparedAdapterCall`——`{ model: resolveModel(...), stream: options => this.stream(options) }`，model 元数据与派发入口绑定同一代适配器）。

| 断言 | 宿主依据 | 本包执法面 | 坏了长什么样 |
|---|---|---|---|
| 宿主 LLM 服务经 `prepareCall` 派发每次模型调用：adapter 级 `prepareCall(provider, model, signal)` 返回 `{ model, stream }`（一次性句柄，防 HMR 混代） | `packages/llm/llm/src/index.ts` 的 `registration.adapter.prepareCall(...)` 调用与 `LlmAdapter` 基类（`PreparedAdapterCall`） | `EvalMockAdapter` 自带 `prepareCall` 覆写（`src/mock/mock-adapter.mjs`）——真跑一条 mock case 即红在具名错误串上 | mock run 空转：无 session 事件、workspace 未落、final text 空，stderr 带 `registration.adapter.<method> is not a function` |

> **维护触发器**：宿主 adapter 线上契约演进（新增/改签名线上方法）⇒ 先对宿主 `packages/llm/llm/src/index.ts` 重验 `EvalMockAdapter` 的自带面（`prepareCall` / `resolveModel` / `stream` 的形状与语义），再同 commit 改本节与 `src/mock/mock-adapter.mjs`。

## 环境面：profile 与插件安装

- 被测插件须已装进所选 profile：`dsh plugin --profile <profile> add <插件目录>`；
- 每条 behavior case 在隔离的临时 `DSH_HOME` 与 workspace 中启动 dsh，通过 `--patch` 把 session JSONL 定向到本次 run——不污染真实 profile store；
- review 默认空白环境：任意 profile 均可，树外插件行由 overlay 枚举禁用（详见 [review.md](review.md)）。

## 凭证

real 层的**模型凭证由 dsh 自行解析**——spawn 的是 dsh 本体，env 原样透传，真实 home 的托管凭证文档（`.credentials.yaml`）会被复制进暂存 home；**你的 dsh 能正常跑，real case 就能跑**。本包不做任何凭证配置，只在启动前做存在性探测（env 或托管文档任一可见）以决定 real case 是否 auto-skip。mock 与 review dry-run 完全不需要凭证。

## spawn 要求

real case 会以管道 stdio spawn 子 dsh CLI（headless 会话、子代理子运行时），因此需要一个能 spawn 子进程的运行面——受限沙箱里可能被拒（`spawn EPERM`），此时在宿主侧终端 / CI 跑即可。mock 与 review dry-run 不 spawn 子 CLI，无此约束。

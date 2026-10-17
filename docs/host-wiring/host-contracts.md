---
description: Host contract assertions — the five session-seam invariants and the LLM adapter online contract, each paired with its enforcement face in this package
---

# 宿主契约断言

behavior 与 review 的证据取自**真实 dsh 会话的产物与进程内日志**，本包因此直接断言宿主的若干 session seam 与 LLM adapter 线上契约。这些契约随宿主演进没有编译期提示，每处断言配一个**执法面**（表中的本包符号）；宿主检出更新后、动本包引用它们的代码或文档前，先按本章对宿主源码重新验证。

## session seam：五处硬断言

| 断言 | 宿主依据 | 本包执法面 | 失配形态 |
|---|---|---|---|
| 会话 artifact 按**格式代**命名：v0 是 `session.jsonl`，之后每代带小写数字（当前 `session.v4.jsonl`）；`compression: none` 时无 `.zstd` 后缀 | `session-persistence-jsonl/src/format.ts` 的 `generationLogFilename`，配 `core/session/src/types.ts` 的 `SESSION_FORMAT_VERSION` | `isSessionLogFilename`（命名判定）+ `collectSessionTrace`（收集）⇒ behavior 失败文案 / review 记账里的 `traceGap` | 只按 v0 名收集 ⇒ 一条日志都收不到；失败文案列出**实际扫到的候选文件名**并写明「宿主 artifact 命名可能已换代」，不再只报 `no session trace materialized` |
| 会话 header 的 `version` 戳是宿主对逻辑代际的声明（当前 v4） | 同上；已发布的代际链见 `session-format-catalog/src/generated.ts`（codecs v0–v4、`currentVersion: 4`） | `KNOWN_SESSION_FORMAT_VERSIONS`（`parseSessionLog` 入口准入，**仅当前代**——其余代际同样拒绝，不留旧格式兼容；eval 只读自跑产物，宿主换代后旧代无存活生产方） | 非本代际（旧或未知）⇒ 解析当场拒绝并报出版本号（`session header version vN is not a known generation`），不再把各投影字段静默降级成空数组 |
| 会话日志是**拼接帧容器**（宿主默认 zstd），须逐帧扫描 | `session-persistence-jsonl/src/zstd.ts` 的帧扫描 | 两张 eval overlay（behavior 的 `buildOverlayYaml` 与 review 适配器的空白环境 overlay）经共享行 `overlaySessionLogRow`（`src/overlay.mjs`）固定 `compression: none` + root=收集根——review 面曾漏钉（宿主默认 zstd 写出 `session.vN.jsonl.zstd`，`isSessionLogFilename` 收不到，工具边界校验恒 `not-executed`） | 整文件一次解压 ⇒ `ZSTD_error_prefix_unknown`（第二帧魔数被当输入） |
| 进程内读 durable 事件的 API 是 `Session#snapshotEvents()`（不可变冻结快照）；早期的 `session.events` getter 已被删除 | `core/session/src/index.ts` 的 `snapshotEvents` | driver 行（`src/driver/multi-turn-driver.mjs`）直接调用，没有回退路径 | 属性访问得到 `undefined` ⇒ 进程内消费者抛 `agent.session.events is not iterable`，整个 headless run 终止 |
| v3 起组装后 system prompt 落 `system/message` **面事件**（流式：append 加节点、replace 换节点；首请求必 commit 节点 0，即使 prompt 为空），`request/header` **不再带** `system` 字段；有效 prompt = 存活节点中最后一个非空 | `core/agent-loop/src/runtime-context.ts` 的 `SystemPromptProjection`（首请求必 commit）+ `core/session/src/surface.ts` 的面折叠 + `core/session/src/types.ts` 的 `EpochHeader`（无 system）+ `session-format-v2-to-v3/src/migration.ts`（streaming system-prompt promotion） | `buildTrace` 的 system/message 面 fold + `systemMessages` / `systemPrompt` 投影 + census `promptSurfaceAbsent`（`src/trace.mjs`）；`systemPromptIncludes` 渠道空置响亮失败 | 投影只读 header.system（v3 前形状）⇒ v3 日志上 `systemPromptIncludes` 恒 false（coggit treatment 臂 10/10 守卫全败形态），census 逐 run 记 `promptSurfaceAbsent` |

命名行与代际行的读取面由本包的 eval overlay 固定（`compression: none`），所以每轮 run 的 artifact 是**明文逐事件**布局；命名判定、代际准入与收集入口都在 `src/trace.mjs`（`isSessionLogFilename` / `KNOWN_SESSION_FORMAT_VERSIONS` / `collectSessionTrace`），behavior runner 与 review adapter 共用同一个收集入口，缺 artifact 时各自把 `traceGap` 带进失败文案与产物记账。帧容器行走 overlay 固定；倒数第二行是 driver 行读日志时直接依赖的方法；末行是投影读 prompt 面的入口。

> **维护触发器**：宿主 session 格式、持久化命名或 `Session` 读取面变更 ⇒ 先按上表对 vendored 检出重新验证断言，再更新本篇与引用它们的源码/认知。前两行已机械执法——命名或代际戳变更时，运行一条 case 即以具名文案失败（候选文件名 / 版本号）；其余三行仍需真跑一条 case 才会暴露。

## LLM adapter 线上契约（mock 模式）

mock 模式经 `eval-mock-llm` 插件（`src/mock/mock-adapter.mjs`）注册 `EvalMockAdapter`，它 `extends` 的 `LlmAdapter` 基类解析自**本包的 peer 实例**——该实例可以落后于驱动它的宿主运行时（实例：宿主 0.1.5-rc.2 对已注册 adapter 新增 `registration.adapter.prepareCall(...)` 调用面而本地 peer 仍为 0.0.1-rc.1 时，继承面缺失，全部 mock run 终止于启动期）。因此适配器**自带** `prepareCall` 覆写、不依赖继承面是否在位：形状镜像宿主基类默认契约（`PreparedAdapterCall`——`{ model: resolveModel(...), stream: options => this.stream(options) }`，model 元数据与派发入口绑定同一代适配器）。

| 断言 | 宿主依据 | 本包执法面 | 失配形态 |
|---|---|---|---|
| 宿主 LLM 服务经 `prepareCall` 派发每次模型调用：adapter 级 `prepareCall(provider, model, signal)` 返回 `{ model, stream }`（一次性句柄，防 HMR 混代） | `packages/llm/llm/src/index.ts` 的 `registration.adapter.prepareCall(...)` 调用与 `LlmAdapter` 基类（`PreparedAdapterCall`） | `EvalMockAdapter` 自带 `prepareCall` 覆写（`src/mock/mock-adapter.mjs`）——真跑一条 mock case 即红在具名错误串上 | mock run 无 session 事件、workspace 未落、final text 空，stderr 带 `registration.adapter.<method> is not a function` |

> **维护触发器**：宿主 adapter 线上契约演进（新增/改签名线上方法）⇒ 先对宿主 `packages/llm/llm/src/index.ts` 重验 `EvalMockAdapter` 的自带面（`prepareCall` / `resolveModel` / `stream` 的形状与语义），再同 commit 改本节与 `src/mock/mock-adapter.mjs`。

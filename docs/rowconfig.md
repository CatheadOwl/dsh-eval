---
description: rowConfig 边界契约——case 级按 loader 行 id 覆写行 config 的机制、整段替换语义与「重述所需键」义务、叶值形状限制、与 disableRows 的分工
---

# rowConfig：case 级行 config 覆写

`rowConfig: Record<rowId, config对象>` 让一个 case 在**本次 run 的 overlay** 里覆写插件行的 config。框架对行 id 与键语义零内置知识（键由目标插件自定义），只做形状校验。典型用例是臂式实验：同一 case 跑两臂，差异臂用 `rowConfig: { prompt: { disabledProviders: ['<provider>'] } }` 关掉单个 provider，而不用 `disableRows` 禁掉整行（那会连工具面一起摘掉，制造混淆变量）。

## 机制

- 序列化为 overlay 条目 `- id: <row>` + `config:` 键值块（`buildOverlayYaml`），与 `session-persistence-jsonl` 重根、`persona`、`disableRows` 走同一条 per-run overlay 通道；
- 取值优先级同 overlay 语义：覆盖 bundle/patch 层为该行声明的 config。

## 整段替换语义（最大的坑）

cordis patch 层的 config 覆写是**整段替换**，不是深合并：`rowConfig` 声明的键集合就是该行生效的**全部** config。行原本带的其他键（如 prompt 行的 `providerTimeoutMs` / `totalTimeoutMs` / `renderBudgetChars`）不会自动保留——**用到哪个键就在 rowConfig 里重述哪个**。这与「惰性只写差异」的直觉相反，是宿主 patch 语义的直接推论（参见 dsh 宿主文档对 patch 的说明：按 id 定位行、整段替换其 config）。

## 形状限制

- 叶值只支持**标量**（string / number / boolean）或**标量数组**（如 `disabledProviders: ['a', 'b']`，YAML flow 序列发射）；
- 嵌套对象不支持（`validateRowConfig` 拒绝）——需要嵌套 config 的行请走自己的 profile patch，不进 case；
- 校验双点：discovery 加载期与 `runEvalCase` 执行期同一份 `validateRowConfig`。

## 与 disableRows 的分工

| | `disableRows` | `rowConfig` |
|---|---|---|
| 效果 | 整行禁用（插件完全不装载） | 行照常装载，config 被覆写 |
| 适用 | 该 case 不需要该插件的任何面 | 该 case 需要插件但想改其行为参数 |
| 组合 | 同一行同时出现在两处是矛盾声明（禁用的行无 config 可言），避免 | |

## 校验示例

```js
// 合法
rowConfig: { prompt: { disabledProviders: ['breadcrumb-description-enricher'], totalTimeoutMs: 5000 } }
// 非法：嵌套对象
rowConfig: { prompt: { a: { b: 1 } } }   // validateRowConfig 拒绝
```

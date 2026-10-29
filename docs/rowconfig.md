---
description: rowConfig 边界契约——case 级按 loader 行 id 覆写行 config 的机制、整段替换语义与「重述所需键」义务、叶值形状限制（含对象数组）、与 disableRows 的分工
---

# rowConfig：case 级行 config 覆写

`rowConfig: Record<rowId, config对象>` 让一个 case 在**本次 run 的 overlay** 里覆写插件行的 config。框架对行 id 与键语义零内置知识（键由目标插件自定义），只做形状校验。典型用例是臂式实验：同一 case 跑两臂，差异臂用 `rowConfig: { prompt: { disabledProviders: ['<provider>'] } }` 关掉单个 provider，而不用 `disableRows` 禁掉整行（那会连工具面一起摘掉，制造混淆变量）。

## 机制

- 序列化为 overlay 条目 `- id: <row>` + `config:` 键值块（`buildOverlayYaml`），与 `session-persistence-jsonl` 重根、`disableRows` 走同一条 per-run overlay 通道；per-case persona 也走本通道（`{ 'system-prompt': { personaPrefix, personaSuffix } }`，case 级 `persona` 字段已删除）；
- 取值优先级同 overlay 语义：覆盖 bundle/patch 层为该行声明的 config。

## 整段替换语义（最大的坑）

cordis patch 层的 config 覆写是**整段替换**，不是深合并：`rowConfig` 声明的键集合就是该行生效的**全部** config。行原本带的其他键（如 prompt 行的 `providerTimeoutMs` / `totalTimeoutMs` / `renderBudgetChars`）不会自动保留——**用到哪个键就在 rowConfig 里重述哪个**。这与「惰性只写差异」的直觉相反，是宿主 patch 语义的直接推论（参见 dsh 宿主文档对 patch 的说明：按 id 定位行、整段替换其 config）。

## 形状限制

- 叶值支持**标量**（string / number / boolean）、**数组**（元素为标量或 plain object）与**嵌套 plain object**（同样递归限制，任意深度）——参数组（如 `variant: { form, emphasis }`）与词表（如 `allowedModels: [{ provider, model }, ...]`）都作为**一个值**表达，不必拍平成互不相关的标量键；
- 数组元素为 plain object 时，对象内部递归遵守同一形状（叶 = 标量 / 数组 / 嵌套对象）；**数组内嵌套数组**（任意深度的 array-in-array）与 `null`（叶值或数组元素）仍拒——null 拒绝沿用放宽前规则，嵌套数组无消费用例故保持关闭（日后开放是向后兼容的放宽，收回则是破坏性变更）；
- 发射形态：标量叶 YAML 原生发射；数组 / 对象叶以一条 JSON flow 值发射——JSON 数组 / 对象即 YAML 1.2 flow sequence / mapping 语法（对象数组即 flow sequence of flow mappings），宿主侧 YAML 解析还原等价对象；
- 校验双点：discovery 加载期与 `runEvalCase` 执行期同一份 `validateRowConfig`。

## 与 disableRows 的分工

| | `disableRows` | `rowConfig` |
|---|---|---|
| 效果 | 整行禁用（插件完全不装载） | 行照常装载，config 被覆写 |
| 适用 | 该 case 不需要该插件的任何面 | 该 case 需要插件但想改其行为参数 |
| 组合 | 同一行同时出现在两处是矛盾声明（禁用的行无 config 可言），避免 | |

## 校验示例

```js
// 合法：标量 / 标量数组 / 嵌套参数组 / 对象数组（词表）
rowConfig: { prompt: { disabledProviders: ['breadcrumb-description-enricher'], totalTimeoutMs: 5000, variant: { form: 'standard', emphasis: 2 } } }
rowConfig: { 'model-router': { allowedModels: [{ provider: 'deepseek', model: 'deepseek-chat' }, { provider: 'p2', model: 'm2' }] } }
// 非法：数组内嵌套数组 / null（叶值、数组元素或对象内叶）
rowConfig: { prompt: { a: [[1]] } }                          // validateRowConfig 拒绝（嵌套数组）
rowConfig: { prompt: { allowedModels: [{ model: null }] } }  // validateRowConfig 拒绝（对象内 null 叶，路径 allowedModels[].model）
rowConfig: { prompt: { a: [null] } }                         // validateRowConfig 拒绝（数组内 null）
rowConfig: { prompt: { a: null } }                           // validateRowConfig 拒绝（null 叶）
```

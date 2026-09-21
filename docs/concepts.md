---
description: 概念对照——从主流 agent eval 叙事（dataset / metric / LLM-as-judge / trajectory / CI）进入本包的词汇映射与差异理由
---

# 概念对照：从主流 agent eval 进入

主流 eval 框架（DeepEval、OpenAI Evals、Inspect AI 一类）把模型调用内嵌在 harness 里、以 metric 评分为轴；任务制品型评测（SWE-bench 一类）发布任务 + 环境 + verifier，由运行方自己供 agent。本包组合两者：real 腿由 profile 供模型、驱动装配后的 harness；mock / review 腿以制品形态运行（免凭证制品 + 确定性 verifier / rubric）。下表把主流词汇映射到本包形态——概念同种，本包取 dsh 垂直解法。

| 你熟悉的概念 | 这里的形态 | 差异一句话 |
|---|---|---|
| unit test | behavior case 的消费心智：作者在写作时把判断冻结进 `expect` 断言，跑时确定性判卷——绿了不看、红了才看 | behavior 层就是 unittest，只是被测对象是装配后的 harness（插件单测够不着的层） |
| dataset / test cases | case 即代码：`*.eval.mjs`（id / mode / task / prepare / expect），fixture 在 `prepare` 播种 | 评测资产随插件仓版本化，不是数据文件 |
| metric / score | matcher（`toolCalled` / `finalTextMatches` / `systemPromptIncludes` …）：契约断言，过 / 不过 | 刻意不打分：插件契约是二值的，分数掩盖「哪条破了」；聚合面是 report 的 pass/fail 计数 |
| custom grader / custom metric | 自定义 matcher（`expect` 内任意断言函数）+ 证据锚纪律（纯负向断言须自报 `requiresEvidence: false`） | 自定义判定仍是确定性证据链，不是自由打分 |
| LLM-as-judge | 不内置判卷模型。comprehension review 里 fresh model 是**答题人**（测的是 surface 可理解性），判分规程写在每份 rubric 的判分节，由人对照答案钥匙执行 | 答题人与判卷人分离；判卷不给仪器身份就不记账，宁缺勿伪 |
| trace / span | dsh session JSONL → `EvalTrace` 投影（tool calls / steer / system prompt 面）+ `census` 普查 | trace 是一等公民且机器可断言；census 防投影静默降级的假绿 |
| trajectory eval | 原生模式：matcher 断工具调用序列、参数路由、模型可见面 | 是对轨迹上的**契约**做断言，不是对轨迹打质量分 |
| end-to-end / task success | behavior real（自然语言意图 → 真实工具选择）+ `inspect` 终态守卫（显式 `evidence: 'inspect'`） | 终态可查走确定性 verifier |
| environment / sandbox | 每 run 暂存 profile 到隔离临时 home + overlay 钉死会话工件形状 | 环境重置是框架保证（try/finally 全路径清理），不是运维前提 |
| eval suite / experiment | case 目录 + `defineBehaviorExperiment`（臂 = case 字段覆写 × 重复 × 守卫 × 聚合） | decisionRule 预注册带指纹，防事后挑规则 |
| CI 集成 | mock 档免凭证、确定性，可作 CI 门（`--fail-on-skip`）；real 档无凭证自动 skip；`--format json` 供聚合 | CI 门按确定性分层，不按范式分层 |
| agent harness | 被测对象本身：plugin + profile + patch + loader row + tool registry 装配成的图 | 主流语境 harness 是承载面；这里它同时是被测对象 |
| benchmark 排名 | 不做 | 插件契约治理 ≠ 模型排名 |

## 刻意不做 → 用什么替代

| 不做 | 替代 |
|---|---|
| metric catalog / 打分 | matcher 契约断言 + `--report` 计数聚合 |
| 内置 LLM 判卷 | 判分规程随 rubric 成文（答题人 / 判卷人分离），判卷对照答案钥匙执行 |
| dashboard | `--format json` / `review-report.md` 机器字段 |
| dataset hosting | case 即代码，随插件仓版本化 |
| benchmark 排名 | release-readiness：报告回答「哪些插件契约绿 / 黄 / 红」 |

---
description: 机器可读报告结构——--format json / --report 的字段语义（环境锚点、per-case 三态 status、派生 summary 与退出码）
---

# 机器可读报告

`--format json`：stdout 只输出一个 JSON 报告对象（过程与失败明细转 stderr），
供 CI / 多插件聚合消费；`--report <file>`：在任一格式下额外把同一报告对象
写入文件。报告构造在 `src/report.mjs`：

```jsonc
{
  "tool": "dsh-eval",
  "profile": "headless", "repo": "<absolute harness checkout>",
  "mode": "mock", "failOnSkip": false,
  "startedAt": "…", "finishedAt": "…",
  "summary": { "selected": 1, "passed": 1, "failed": 0, "skipped": 0 },
  "results": [
    {
      "id": "…", "file": "…", "mode": "mock", "status": "pass",
      "exitCode": 0, "timedOut": false, "durationMs": 5000
      // fail 时另有 failures[]、artifactsDir；skip 时另有 skipReason；
      // case 文件加载失败/重复 id 这类文件级失败也进 results（无 mode 字段）
    }
  ]
}
```

status 取值 `pass | fail | skip`；退出码与文本格式完全一致（同一
`reportExitCode` 派生）。默认 `--format text` 输出为人类可读进度行 + 汇总行。

---
description: GitHub 主页评审协议——dispatch prompt 模板（README 作为独立 repo 主页的四维评审）+ 机械验收断言 + intentional design；主页结构性改动后按此派遣
---

# GitHub-homepage review 协议（README.md）

**问题**：README 是本包独立 repo 的主页（npm 页正文同步），不是工作手册。
结构性改动后按本协议派遣一轮评审。通用形态（骨架清单、噪音标准、模块页
变体、机械预扫）见族技能 homepage-review（skills/review-evals，名称引用）；
本文件是其在 eval 包的专属实例。

## Dispatch prompt 模板

```text
You are reviewing the README.md of the npm package `@catheadowl/dsh-eval`
(working dir: <包根绝对路径>) as if it were the HOMEPAGE of its own
standalone GitHub repository. It is NOT an internal working manual — you have
ZERO context about any dev repository. Judge exactly what ships: README.md,
docs/, package.json, LICENSE, bin/, src/ (the `files` whitelist).

Review dimensions, weigh each, cite file + named symbol/heading (no line
numbers):

1. Comprehension — from this page alone, can a fresh reader understand what
   this IS, and reach a runnable quickstart within a screen or two?
2. GitHub-homepage fitness — value proposition and relationship to the dsh
   host: why it exists (vs unit tests / generic eval frameworks), what it
   needs from the host, positioning credible?
3. Inexplicable leakage — mentions of meta layers or non-host projects a
   standalone visitor cannot make sense of. Plain-text by-name citations are
   the accepted convention; flag any that read as noise rather than
   provenance.
4. Homepage vs docs split — content that belongs in docs/ instead; any
   dangling reference to content not shipped?

Do NOT modify files. Output: per-dimension findings with severity
(blocker / should-fix / nit / fine-as-is) + concrete change suggestion; a
prioritized top-5 action list; verdict: approve / approve-with-nits /
request-changes.
```

## 验收断言（机械可查，验收者可为另一空白 agent）

- [ ] 覆盖全部四维，每维有显式判定（含 fine-as-is）
- [ ] 每条 finding：严重度 + 证据（文件 + 具名符号/标题，禁行号）+ 修改建议
- [ ] 三值终判（approve / approve-with-nits / request-changes）
- [ ] 声称「访客无法理解」须给阅读序列卡点；声称「泄露」须引原文并说明
      为何独立仓访客困惑
- [ ] blocker 仅限：主页定位错误、阻断安装/使用的错误指引、对独立发布
      直接有害的泄露

## 已知 intentional design（防重复争论）

- 按名引用外部证据（兄弟包名、可模仿 case 名）是接受的出处形态；评审判
  的是噪音与否，不是"出现即违规"
- README 面向双读者（消费者 + 维护者）是刻意选择
- docs/ 随包发布；tests/ 与 scripts/ 刻意不发布

---
description: Compiled dsh CLI location — resolution order (npm install tree by default, checkout via --repo or junction), self-diagnostic
---

# 运行面：构建好的 dsh CLI

dsh CLI 按以下顺序定位，先命中者生效：

1. **解析层（默认）**：`node_modules/@deepseek-ai/dsh/lib/bin.js`。宿主与 eval 同装（`npm i -D @deepseek-ai/dsh @catheadowl/dsh-eval`）即由安装树提供，零维护——这是推荐形态（2026-10-26 冷装实测）。
2. **显式 flag**：`--repo <host-checkout>`（检出须已构建，`apps/cli/lib/bin.js` 存在）——checkout 钉定形态。
3. **config `repo` 键**：legacy，已从各包入库 config 退役。

checkout 钉定开发形态下，解析层由 junction 指到宿主检出；junction 失效时须重建为指回本地宿主检出（机器相关的开发环境事务，不入库，同 peer 接线的 gitignore 纪律）。

**代际钉版**：被驱动的就是本安装树的 CLI——把 `@deepseek-ai/dsh` 钉在与你的 profile 所跑宿主相同的版本（`npm i -D @deepseek-ai/dsh@<version>`）。驱动宿主与生产宿主的代际错位不会报错，只会给假判定：case 验的是驱动闭包的组装，不是你生产闭包的组装。

三层全缺时 fail-loud，报错含占位符修法指引。自诊断：

```bash
node -e "console.log(require('fs').existsSync('node_modules/@deepseek-ai/dsh/lib/bin.js'))"
```

`false` 即解析层缺 CLI：默认形态 = 补装宿主（`npm i -D @deepseek-ai/dsh`）；checkout 钉定形态 = 重建 junction 指向宿主检出（检出未构建则先构建宿主）。behavior 与 review 的真实运行都从定位到的 CLI spawn dsh 本体。

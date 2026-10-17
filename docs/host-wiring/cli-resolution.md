---
description: Compiled dsh CLI location — the three-layer resolution chain, self-diagnostic, and junction maintenance discipline
---

# 运行面：构建好的 dsh CLI

dsh CLI 按以下顺序定位，先命中者生效：

1. **显式 flag**：`--repo <host-checkout>`（检出须已构建，`apps/cli/lib/bin.js` 存在）。
2. **解析层**：`node_modules/@deepseek-ai/dsh/lib/bin.js`。开发态由 junction 指到宿主检出，junction 失效时须重建为指回本地宿主检出；消费态由安装树提供。
3. **config `repo` 键**：legacy，已从各包入库 config 退役。

三层全缺时 fail-loud，报错含占位符修法指引。自诊断：

```bash
node -e "console.log(require('fs').existsSync('node_modules/@deepseek-ai/dsh/lib/bin.js'))"
```

`false` 即解析层缺 CLI：先重建上述 junction 指向宿主检出；仍为 `false` 则宿主检出未构建，先构建宿主。junction 维护是机器相关的开发环境事务，不入库，由各开发环境自行承接（同 peer 接线的 gitignore 纪律）。behavior 与 review 的真实运行都从定位到的 CLI spawn dsh 本体。

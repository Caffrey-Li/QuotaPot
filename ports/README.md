# 端口怎么接入

先看 `ports/cursor/`，它是功能最全的参考实现。注册表在 `ports/registry.mjs`：新增端口时加一行 import，并放进 `ports` 数组。

```js
import * as example from './example/index.mjs'
export const ports = [cursor, claude, codex, dsh, workbuddy, example]
```

`import` 端口模块时不能起服务、不能发请求、不能读大文件。`discover()` 只做存在性判断。

## 原则：只声明真正能做的

界面只看 `capabilities`，不看端口名。做不到的部分**不声明、不导出**，界面就不显示，不再放一排灰色的「降级」说明。

```js
export const capabilities = {
  usage: true,        // 「用量」页：今日 / 7 天 / 30 天，按模型分卡片
  chats: true,        // 「对话」页：上下文比例、80% 提醒、整理和继承、提示词
  quota: false,       // 「用量」页顶部的额度条，来自 menu()
  modelStatus: false, // 只在能读到服务端模型状态时为 true（目前只有 Cursor）
  actions: {
    open: false,      // 点对话行能否打开这条对话
    paste: 'copy',    // 'place' 写进该对话的输入框；'copy' 只复制到剪贴板；false 没有
    spawn: false,     // 能否带着提示词在原项目开新对话
  },
}
```

`usage` 和 `chats` 至少要有一个为 true，否则这个端口没有东西可显示，不要注册（Grok Bot 就是因此被去掉的）。

## 按能力导出

| 能力 | 必须导出 |
| --- | --- |
| 总是 | `id`、`name`、`capabilities`、`promptProfile`、`discover()`、`prompts(kind, chat)` |
| `usage` | `usage(days, onProgress)`、`peekUsage(days)` |
| `chats` | `chats(onProgress)`、`peekContext()`、`headers()` |
| `quota` | `menu()` |
| `modelStatus` | `models()` |
| `actions.paste` | `paste({ text, chatId })` |
| `actions.open` | `open({ chatId, phase, ticket })` |
| `actions.spawn` | `spawn({ text, workspace })` |

`node desktop.mjs --check` 会逐个核对：声明了的能力要有对应函数；`paste` 只能是 `'place'`、`'copy'` 或 `false`；端口不能再导出 `diskTargets()`。服务端对没有导出的函数直接返回 404 和中文原因。

`models()` 和 `headers()` 在服务端不会被 `await`，必须是同步函数。

## 返回结构

| 函数 | 成功时 | 失败时 |
| --- | --- | --- |
| `discover()` | `{ ok:true, installed:true, home }` | `{ ok:false, degraded:true, installed:false, reason }` |
| `usage(days, onProgress)` | `{ ok:true, unit, days, tokens, calls, models:[{ model, tokens, calls }], truncated, note? }` | `degrade(原因)` |
| `chats(onProgress)` | `{ ok:true, warnPercent, chats:[{ id, name, model, used, limit, percent, createdAt, updatedAt, workspace, measured, compactions, lostRatio, growth, warn }] }` | `degrade(原因)` |
| `headers()` | `{ ok:true, chats:[{ id, name, createdAt }] }` | `degrade(原因)` |
| `menu()` | 见下方「额度」 | `degrade(原因)`，界面显示成一行「额度：原因」 |
| `models()` | `{ ok:true, models:[{ name, status, statusText, detail }] }`，界面只显示 `status > 0`（降级、停用）的模型 | `degrade(原因)` |
| `paste()` | `'place'`：`{ ok:true, placed:true }`；`'copy'`：`{ copied:true, placed:false }` | `{ ok:false, copied:false, error }` |
| `open()` | `{ ok:true, ticket }`；需要原生窗口去激活 Cursor 并按快捷键时加 `bridge:true` | `{ ok:false, error }` |
| `spawn()` | `{ ok:true, spawned:true }` | `{ ok:false, error }` |

`onProgress({ done, total, label, etaMs })` 用来画进度条。失败统一用 `ports/degrade.mjs` 的 `degrade(原因)`，原因用中文。不要返回 0 冒充结果，不要借别的端口的数据。

没有上下文采样时不要写「压缩 0 次」：未测量的条目 `measured:false`，`lostRatio`、`growth` 用 `null`。

## 单位和额度

`usage()` 和 `menu()` 必须带 `unit`：`token`、`credits`、`percent`、`currency`。credits、余额、百分比不能放进 `unit:'token'`。

`menu()` 的几种形状：

- 账期百分比：`{ ok:true, unit:'percent', usedPercent, planName?, billingCycleEnd? }`
- 限流窗口：`{ ok:true, unit:'percent', primary:{ usedPercent, windowMinutes, resetsAt }, secondary, stale }`，`windowMinutes` 为 300 / 10080 时界面写「5 小时窗口」「7 天窗口」
- 余额：`{ ok:true, unit:'currency', amount, display:'余额 ¥12.34' }`

## 两种整理流程

- `paste:'place'`（Cursor）：整理 / 一键开新 → 继承对话 → 不再显示按钮。只有 `placed:true` 才算整理成功。支持「一键整理」。
- `paste:'copy'`（Claude Code、Codex、WorkBuddy）：复制整理 → 复制继承 → 不再显示按钮。复制成功即进入下一步，没有「一键整理」和「一键开新」。

## 提示词

四条正文由 `ports/prompts.mjs` 的 `renderPrompt(profile, kind, chat)` 生成，端口只提供 `promptProfile`：

- `product`：产品名，例如 Cursor
- `instructionsFile`：指令文件名，例如 AGENTS.md
- `compactCommand`：没有就用空字符串。有的话整理提示词多一行「需要压缩时可以使用该命令。」
- `hasContext`：没有上下文数字时设为 false，整理和继承提示词会删掉上下文那一行，不写 0
- `warnPercent`：默认 80

提示词只在「对话」页底部的「提示词」折叠区显示，没有 `chats` 的端口不显示。

## 磁盘

空间页扫描整台机器，不按端口划分。所有目录都在根目录的 `disk.mjs`，每项带 `group`（按工具分组）。一个目录在同组另一个目录里面时，界面把它显示成子项；同时选中时只删外层，释放空间只算一次。端口发现了可以安全清理的新目录，加进 `disk.mjs`，不要放在端口里。

## 自检

`ports/<id>/fixtures/` 放脱敏小样本，每个读取的数据源至少一个。去掉 token、API key、JWT、邮箱、真实对话正文和路径里的用户名。

`ports/<id>/check.mjs` 只读 fixtures，跑通解析、单位和提示词，不能要求本机安装了这个产品。`node desktop.mjs --check` 会依次执行每个已注册端口的 `check.mjs`。

读 SQLite 用 `ports/sqlite.mjs` 的 `openRead`（`readOnly: true`）。写入用 `openWrite`，用完关闭。不要调用 `sqlite3` 命令行。

## 界面路由

页面请求 `/api/ports` 和 `/api/ports/<id>/{usage/stream, context/stream, headers, menu, models, prompts, paste, spawn, open}`。只有一个已安装端口时，端口切换条隐藏。端口切换条只在「对话」和「用量」页出现。

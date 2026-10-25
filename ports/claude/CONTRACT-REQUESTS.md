# Claude 端口的合同请求

按影响排序。前两条不改，Claude 的三个动作只能一直关着。

## 1. 点对话行时，原生窗口总是去激活 Cursor

`ui/index.html` 的 `openChat()` 在 `open` 成功后总是 `postMessage({ action: 'focusChat' })`，`native/Window.swift` 收到后执行 `focusCursorChat()`：激活 Cursor 并按 `ctrl+alt+cmd+shift+q`。行的 title 也写死「已切到 Cursor 里的这条对话」。

Claude 的 `open()` 会自己打开终端。如果此时界面再发 `focusChat`，会把焦点切到 Cursor 并向 Cursor 发快捷键。

请求：能力里区分打开方式，例如 `actions.open: 'bridge' | 'self' | false`。只有 `'bridge'` 才发 `focusChat`；`'self'` 只调用端口的 `open`，phase 只有 `arm`。title 用 `portPrompt.product`。

## 2. 没有「写入输入框」的端口，永远开不了新对话

`renewChat()` 要求 `tidyChat()` 返回 `placed: true` 才调用 `spawn`；「继承对话」只在 `tidied` 里有记录时出现，而 `tidied` 只在 `placed: true` 时写入。Claude、Codex 都只能复制，所以 `spawn: true` 时按钮出现但永远失败。

请求：增加「只复制」档，例如 `actions.paste: 'copy'`。界面显示「复制整理」：复制成功后提示「已复制，请粘贴到该对话，等它输出交接正文」，并记入 `tidied`，之后出现「继承对话」。「一键开新」在这一档下隐藏，因为整理必须由旧对话里的模型完成，无法一步做完。

## 3. spawn 只拿到项目的目录名

界面发送 `{ text, workspace: chat.workspace }`，`workspace` 是目录名（为了和 Cursor 显示一致）。Claude 要 `cd` 到完整路径。现在端口在最近 200 个会话里按目录名反查，只有唯一匹配才用，否则报错。

请求：spawn 的请求体同时带上 `chatId`，以及条目里的 `workspacePath`（Claude 的对话条目已经提供，形如 `~/Projects/demo`）。

## 4. 只复制时按钮写「已粘贴」

`placePrompt()` 在 `ok && !placed` 时显示「已粘贴」。Claude 的 `paste()` 返回 `{ ok:true, copied:true, placed:false }`，应显示「已复制」。

## 5. 界面里还写死了 Cursor

- `tidyAll()` 的确认框：「不会切到 Cursor」
- `renewChat()` 的确认框：「不会切到 Cursor」
- 用量页截断说明：「只汇总了最近 3000 条」是 Cursor 的分页上限。Claude 不截断，但其他端口截断的条件不同。建议端口在 `usage()` 里返回 `truncatedNote`。

## 6. 能力是静态的，但 Claude 的能力取决于装了什么

只装 Claude 桌面版时，用量、模型、对话都只能降级。现在靠运行时返回 `degrade()` 处理，界面会显示三个灰色页面。

请求：`describe()` 允许 `capabilities` 是函数，或者读取 `discover().sources` 后再决定，让界面能直接隐藏这些页。

## 7. 合同文档补两点

- `models()` 和 `headers()` 在 `desktop.mjs` 里没有 `await`，必须是同步函数。README 没写，返回 Promise 会被序列化成 `{}`。
- `snapshot.json` 是所有端口共用的，Cursor 用了顶层的 `usage`、`context`、`trends`、`composers`。Claude 用 `snapshot().claude`。建议合同规定每个端口只写自己 id 下的键，并提供一个辅助函数。

## 8. 磁盘目标和旧扫描的 id 重叠

空间页现在还用旧核心的合并扫描。旧核心里有 `claude-home`、`claude`、`claude-gpu`、`claude-dawn`、`claude-cache`，本端口用了相同的 id 和路径，另外新增 `claude-codecache`、`claude-updates`。合并磁盘槽时按 id 去重即可。

## 9. 与端口无关，但阻碍自检

已解决：`desktop.mjs` 原来用绝对路径 import 旧版 DSH 插件的 `index.js`，在别人机器上会失败。磁盘目录表已复制到本仓库的 `disk.mjs`，余额、旧用量、agents 三个无界面的接口已删除。

# 端口怎么接入

先看 `ports/cursor/`。合同以那里的导出名和返回结构为准。阶段 0 只注册了 Cursor。空间页仍使用旧的合并扫描，磁盘槽的合并不在这一阶段。

注册表在 `ports/registry.mjs`。新增端口时加一行 import，并放进 `ports` 数组。端口自己的目录不要改这个文件，把要加的那一行写进自己的 README，交给合并的人。

```js
import * as example from './example/index.mjs'
export const ports = [cursor, example]
```

`import` 端口模块时不能起服务、不能发请求、不能读大文件。`discover()` 只做存在性判断。

## 必须导出

| 导出名 | 参数 | 成功时 | 做不到时 |
| --- | --- | --- | --- |
| `id` |  | 小写短名，用作目录名和 URL |  |
| `name` |  | 界面上的名字 |  |
| `capabilities` |  | 见下文 |  |
| `promptProfile` |  | `{ product, instructionsFile, compactCommand, hasContext, warnPercent }` |  |
| `discover()` | 无 | `{ ok:true, installed:true, home }` | `{ ok:false, degraded:true, installed:false, reason }` |
| `usage(days, onProgress)` | `days` 为 1、7 或 30。`onProgress({ done, total, label, etaMs })` | `{ ok:true, unit, days, tokens 或对应数值, calls, models, truncated }` | `degrade(原因)` |
| `models()` | 无 | `{ ok:true, headline, note, models:[{ name, vendor, status, statusText, detail, speed }] }` | `degrade(原因)` |
| `chats(onProgress)` | 进度参数同上 | `{ ok:true, warnPercent, chats:[...] }` | `degrade(原因)` |
| `headers()` | 无 | `{ ok:true, chats:[{ id, name, createdAt }] }` | `degrade(原因)` |
| `prompts(kind, chat)` | `kind` 为 `new`、`handoff`、`inherit`、`crash` | `{ ok:true, kind, text }` | `degrade(原因)` |
| `paste({ text, chatId })` | 没有 `chatId` 表示当前输入框 | `{ ok:true, placed:true }` 或只复制成功 | `{ ok:false, error }` |
| `spawn({ text, workspace })` |  | `{ ok:true, spawned:true }` | `{ ok:false, error }` |
| `open({ chatId, phase, ticket })` | `phase` 为 `arm` 或 `done` | `{ ok:true, ticket }`。需要窗口去激活 Cursor 并按快捷键时再加 `bridge:true` | `{ ok:false, error }` |
| `diskTargets()` | 无 | `[{ id, label, path, safe, hint }]` | 返回空数组，并在 README 说明 |
| `menu()` | 无 | `{ ok:true, unit:'percent', usedPercent }` 或其他真实单位 | `degrade(原因)` |
| `peekUsage(days)` / `peekContext()` |  | 上次快照，没有就 `null` |  |

降级统一用 `ports/degrade.mjs` 的 `degrade(原因)`，得到 `{ ok:false, degraded:true, reason:'中文原因' }`。原因用中文。不要返回 0 冒充结果，不要借别的端口的数据。

界面只看 `capabilities`，不看端口名：

```js
capabilities = {
  discover: true,
  usage: true,
  models: true,
  chats: true,
  prompts: true,
  disk: true,
  menu: true,
  actions: { open: false, paste: false, spawn: false },
}
```

`actions.paste` 为 false 时不显示「整理」。`actions.spawn` 为 false 时不显示「一键开新」和「继承对话」。`actions.open` 为 false 时行点击不切换对话。做不到的动作在函数里返回错误，同时在 capabilities 里标 false。

## 单位

`usage()` 和 `menu()` 必须带 `unit`：`token`、`credits`、`percent`、`currency`。界面按单位格式化。credits、余额、百分比不能放进 `unit:'token'`。

没有生成耗时，`models()` 里 `speed` 用 `null`，界面显示「无耗时」。没有上下文采样，不要写「压缩 0 次」；`chats()` 里未测量的条目 `measured: false`，`lostRatio` 和 `growth` 用 `null`。

## 提示词

四条正文由 `ports/prompts.mjs` 的 `renderPrompt(profile, kind, chat)` 生成。端口只提供 `promptProfile`：

- `product`：产品名，例如 Cursor
- `instructionsFile`：指令文件名，例如 AGENTS.md
- `compactCommand`：没有就用空字符串。有的话整理提示词多一行「需要压缩时可以使用该命令。」
- `hasContext`：没有上下文数字时设为 false，整理和继承提示词会删掉上下文那一行，不写 0
- `warnPercent`：默认 80

`prompts(kind, chat)` 调用这个函数即可。

## 自检

`ports/<id>/fixtures/` 放脱敏小样本，每个读取的数据源至少一个。去掉 token、API key、JWT、邮箱、真实对话正文和路径里的用户名。

`ports/<id>/check.mjs` 只读 fixtures，跑通解析、降级、单位和提示词。不能要求本机安装了这个产品。`node desktop.mjs --check` 会依次执行每个已注册端口的 `check.mjs`。

读 SQLite 用 `ports/sqlite.mjs` 的 `openRead`（`readOnly: true`）。写入用 `openWrite`，用完关闭。不要调用 `sqlite3` 命令行。

## 界面路由

页面请求 `/api/ports` 和 `/api/ports/<id>/...`。只有一个已安装端口时，切换控件隐藏，页面与单端口时一致。

# Grok Bot 端口（`grok`）

本目录是 QuotaPot 的 Grok Bot 适配器。**不要改** `ports/registry.mjs`；合并的人按下面一行注册。

## 注册表（交给合并的人）

```js
import * as grok from './grok/index.mjs'
// and add grok into ports array: export const ports = [cursor, grok]
```

## 本机核实过的路径（America/Edmonton 机器）

| 项 | 值 |
| --- | --- |
| App | `/Applications/Grok Bot.app`（存在） |
| Bundle id | `com.anysphere.sand` |
| Version seen | `0.75.8` |
| URL schemes | `grokbot`, `sand` |
| User data | `~/Library/Application Support/Grok Bot`（Electron；含 Cache / Code Cache / GPUCache / Dawn* / sand-client-persistence 等） |
| Library caches | `~/Library/Caches/com.anysphere.sand`、`~/Library/Caches/com.anysphere.sand.ShipIt` |
| 用量 / 额度 JSON | Application Support 下**未找到**本地 usage/quota/billing 文件（Bot 在云端） |

读取过的本机内容：`Info.plist`（bundle id / URL schemes / version）、Application Support 目录列表、Library Caches 目录存在性。未读钥匙串、未读 token、未打开 asar 以外的敏感文件正文写入 fixtures。

## 槽位状态

| 槽 | 状态 | 说明 |
| --- | --- | --- |
| 发现 discover | 做到 | 检查 `/Applications/Grok Bot.app`；有数据目录则 `home` 为 `~/Library/Application Support/Grok Bot`，否则为 app 路径（tilde 缩短） |
| 用量 usage | 降级 | Grok Bot 在云端运行，本机没有用量数据 |
| 模型 models | 降级 | 本机没有 Grok Bot 的模型目录 |
| 对话 chats / headers | 降级 | 对话在云端，本机没有上下文 / 对话列表 |
| 动作 open / paste / spawn | 降级 | 不调用 `open` / osascript；深链见 CONTRACT-REQUESTS.md |
| 提示词 prompts | 做到 | 四条（new / handoff / inherit / crash）；`hasContext:false`；只复制，不粘贴不 spawn |
| 磁盘 disk | 做到 | 用户数据 `safe:false`；App Support 下 Cache/Code Cache/GPUCache/Dawn* 与 Library Caches / ShipIt `safe:true` |
| 菜单 menu | 降级 | 本机读不到 Grok Bot 的额度 |

`promptProfile`：`product: 'Grok Bot'`，`instructionsFile: 'AGENTS.md'`，`compactCommand: ''`，`hasContext: false`，`warnPercent: 80`。

## 交付物

- `index.mjs` — 适配器（import 无副作用）
- `fixtures/` — 脱敏样本：`discover-paths.json`、`degrade-samples.json`、`prompts.json`、`disk-targets.json`
- `check.mjs` — 只靠 fixtures + 纯函数，不要求本机安装 Grok Bot
- `CONTRACT-REQUESTS.md` — URL scheme / 打开对话 / 用量来源想法（不改共享合同）

## 本机验收

```bash
cd quotapot
node ports/grok/check.mjs
```

验收时**没有**真正执行打开、粘贴或 spawn Grok Bot。

## 本机验收结果

```
$ node ports/grok/check.mjs
grok port check ok
```

Exit code: 0（America/Edmonton 本机，未打开 Grok Bot、未粘贴、未 spawn）。


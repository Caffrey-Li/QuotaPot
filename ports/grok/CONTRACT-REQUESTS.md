# CONTRACT-REQUESTS（grok）

本文件只记录希望共享合同或上游产品补充的能力，**不修改** `ports/degrade.mjs` / `ports/prompts.mjs` / `ports/registry.mjs` / `desktop.mjs`。

## 已核实的 URL schemes

来自 `/Applications/Grok Bot.app/Contents/Info.plist`：

- 注册 scheme：`grokbot`、`sand`

来自产品文档（非 asar 抓取）的已知深链形态：

| 用途 | 形态 | 本端口处理 |
| --- | --- | --- |
| 打开某个 agent | `grokbot://app/v1/agent?id=<agent-uuid>` | **未实现** `open`（能力标 false，函数降级） |
| 设置页锚点 | `grokbot://app/v1/settings?id=<anchor>` | 仅文档 |
| 侧栏 tab | `grokbot://app/v1/sidebar?tab=<overview\|routines\|media\|computer\|members>` | 仅文档 |
| Bot 模板 | `grokbot://app/v1/bot-template?id=<share-id>` | 仅文档 |
| MCP OAuth 回调（asar 内） | `grokbot://mcp/oauth/callback` | 与对话无关 |

## 打开对话 / 新开对话（未实现）

- **open-conversation**：文档有 `grokbot://app/v1/agent?id=...`，但本端口验收要求不真正打开，且缺少稳定的「当前对话 id → 本地可枚举」映射，故 `actions.open=false`，`open()` 返回中文错误。
- **new-chat / spawn with prompt**：未找到可靠的「带提示词开新对话」CLI 或 URL 参数约定；`actions.spawn=false`，`spawn()` 降级。
- **paste**：没有可写入的本地输入框 / composer 接口；`actions.paste=false`。

若上游提供稳定的：

1. 列出本机或账号下 agent/conversation id 的只读 API 或本地索引；
2. `grokbot://...` 带 `prompt=` / `text=` 开新；
3. 或官方 CLI（类似 `cursor agent`）；

再由合并 agent 决定是否扩展合同里的 `actions` 语义。

## 用量 / 额度来源想法

本机核实：

- `~/Library/Application Support/Grok Bot` 下是 Electron 缓存与 client persistence，**没有**可读的 usage / quota / billing JSON。
- Bot 逻辑在云端；本机无法用本地文件拼出 token/credits。

可能的上游来源（需官方确认，**不要**在本端口里猜测实现）：

1. 账号设置页 / 网页账单（需要登录态，不适合无头扫本地）。
2. 官方 usage API（若有，应走用户授权的 connector，而不是刮本地 Cookie）。
3. 若将来桌面端把 residual quota 写入 Application Support，再新增读取槽并更新 fixtures。

当前 `usage` / `models` / `chats` / `headers` / `menu` 一律 `degrade`，原因中文见 `fixtures/degrade-samples.json`。

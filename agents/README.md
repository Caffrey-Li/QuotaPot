# QuotaPot inside AI agents

QuotaPot is not a separate monitoring app. The integration is a shared **MCP server** that each agent can call as a plugin/tool. The Cursor extension and the DSH web pill are additional front ends.

![QuotaPot whale in Cursor](cursor-preview.png)

## One MCP server, four hosts

Server: `agents/codex-marketplace/plugins/quotapot/server.cjs`

Tools:

- `quotapot_status` — DeepSeek, Cursor, Codex, WorkBuddy, ZCode
- `quotapot_balance` — DeepSeek balance
- `quotapot_cursor_usage` — Cursor billing period
- `quotapot_codex_usage` — Codex token totals and rate limits
- `quotapot_usage_models` — per-model tokens/credits for today / 7d / 30d

`quotapot_usage_models` aggregates DSH calls by provider/model, Codex sessions by `turn_context.model`, and WorkBuddy credits by session model. Cursor has no model-level data.

### WorkBuddy

Already merged into `~/.workbuddy/mcp.json` (backup next to it):

```json
"quotapot": {
  "command": "/Users/caffrey/.hermes/node/bin/node",
  "args": ["/Users/caffrey/.dsh/bot/workspace/dsh-bot-QuotaPot/agents/codex-marketplace/plugins/quotapot/server.cjs"],
  "env": {}
}
```

Restart WorkBuddy. In the connector management page, find the new `quotapot` server and click **Trust**. Then ask:

> 用 QuotaPot 查一下余额、用量，并按模型统计 30 天用量。

### Claude Desktop

Already merged into `~/Library/Application Support/Claude/claude_desktop_config.json` (backup next to it):

```json
"mcpServers": {
  "quotapot": {
    "command": "/Users/caffrey/.hermes/node/bin/node",
    "args": ["/Users/caffrey/.dsh/bot/workspace/dsh-bot-QuotaPot/agents/codex-marketplace/plugins/quotapot/server.cjs"],
    "env": {}
  }
}
```

Quit and reopen Claude. Then ask the same question in a chat.

> Claude Code CLI is not installed on this machine. If you install it, the same server can be added to its `.mcp.json`.

### ZCode

ZCode uses a plugin marketplace with `.zcode-plugin/plugin.json` + `.mcp.json`. A local plugin has been written to:

```text
~/.zcode/cli/plugins/cache/quotapot-local/quotapot/0.1.0/
~/.zcode/cli/plugins/marketplaces/quotapot-local/marketplace.json
```

It is also listed in the official marketplace file (backup next to it) so it can be enabled from the plugin page. Restart ZCode, open Plugins, enable **QuotaPot**.

### Codex

Already configured in `~/.codex/config.toml` with the local marketplace under `agents/codex-marketplace`. Restart ChatGPT/Codex.

### Trae

The installed app is **TRAE SOLO CN 0.1.36**. Its CLI rejects third-party VSIX files with `ScanningExtension: Cannot read the extension` — a minimal empty VSIX fails too. I also found no MCP configuration surface in this build. QuotaPot cannot be installed into Trae Solo as a plugin. The same MCP server/VSIX should be tested on a standard Trae IDE or VS Code; this machine only has the Solo build.

## DeepSeek key for MCP hosts

GUI agents often do not inherit `DEEPSEEK_API_KEY`. Put it in a private file instead:

```sh
mkdir -p ~/.quotapot
printf '{"deepseekApiKey":"sk-..."}\n' > ~/.quotapot/config.json
chmod 600 ~/.quotapot/config.json
```

The skeleton file already exists with `{}`. The file is read by the MCP server; the Cursor extension uses SecretStorage first and falls back to it.

## Cursor extension

Installed as `caffrey-li.quotapot` 0.2.0. Reload Cursor, then use the QuotaPot side bar / status bar. It adds WorkBuddy credits and ZCode plan under **Other AI tools**, and hides the Cursor-only card when the host is Trae (if a compatible Trae build ever loads it).

Build/install:

```sh
cd agents/cursor-extension
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
  --install-extension "$PWD/quotapot-0.2.0.vsix"
```

## Limits

- **Cursor** usage is its private `api2.cursor.sh` dashboard API; it can break.
- **Codex** only sees local sessions that record `token_count`; "today" can be 0.
- **WorkBuddy** exposes credits, not token counts; per-model breakdown uses `sessions.model`.
- **ZCode** exposes plan entitlement, not usage; disk only.
- **Claude Desktop** and **Trae** have no local token/quota API; only explicit "no local usage" plus disk.

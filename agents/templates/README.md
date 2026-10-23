# Host config templates

All templates run the server from GitHub, so there are no local paths to edit:

```text
npx -y --package github:Caffrey-Li/dsh-bot-QuotaPot#v0.4.0 quotapot-mcp
```

The first launch downloads the package; increase any MCP startup timeout to 60s if your host is slow.

- `claude.json` — merge `mcpServers` into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), then restart Claude.
- `workbuddy.json` — merge into `~/.workbuddy/mcp.json`, restart WorkBuddy, then click Trust on the new connector.
- `codex/.mcp.json` — drop into a local Codex plugin directory and enable it from a local marketplace.
- `zcode/.zcode-plugin/plugin.json` + `zcode/.mcp.json` — copy the whole `zcode` directory to a plugin cache directory, copy `marketplace.json` next to a marketplace, and replace `__PLUGIN_DIR__` with the absolute plugin directory. Restart ZCode and enable QuotaPot.

## Offline / local clone alternative

If you prefer not to use npx, clone the repository and replace the command:

```json
{
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/dsh-bot-QuotaPot/agents/mcp/server.cjs"],
  "env": {}
}
```

## DeepSeek key

Create `~/.quotapot/config.json`:

```json
{ "deepseekApiKey": "sk-..." }
```

and `chmod 600 ~/.quotapot/config.json`.

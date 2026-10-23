# QuotaPot

> DeepSeek balance, Cursor / Codex / WorkBuddy / ZCode usage, and a whale.  
> One repository, three installable forms: a DSH plugin, a Cursor/VS Code extension, and an MCP plugin.

![QuotaPot](docs/screenshot.png)

## Features

- **DSH / DS Bot** — balance pill, today/7d/30d usage, session spans, daily token limit, low-balance warning, update prompt, disk monitor, whale.
- **Cursor / VS Code / standard Trae** — collapsible side bar, status bar, Cursor usage, Codex usage, other AI tools, thresholds, whale.
- **WorkBuddy / Claude Desktop / ZCode / Codex** — MCP plugin with five tools, no separate UI.
- **Per-model usage** — model-level tokens/credits for DSH, Codex and WorkBuddy.

## Install

### DeepSeek Harness / DS Bot

Settings → Plugins → Add plugin:

```text
github:Caffrey-Li/dsh-bot-QuotaPot#v0.4.1
```

CLI, offline `.tgz` and desktop notes: [configuration](docs/CONFIG.en.md#install-notes).

### Cursor / VS Code / standard Trae

Download and install:

[quotapot-0.2.0.vsix](https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases/download/v0.4.1/quotapot-0.2.0.vsix)

Then run `Developer: Reload Window`. TRAE SOLO CN does not accept third-party VSIX files; use a standard Trae IDE.

### WorkBuddy / Claude Desktop / ZCode / Codex

Run the MCP server directly; no npm publishing required:

```sh
npx -y --package https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases/download/v0.4.1/dsh-bot-quotapot-mcp-0.4.1.tgz quotapot-mcp
```

Host templates: [agents/templates](agents/templates). Full matrix: [agents/README.md](agents/README.md).

## MCP tools

- `quotapot_status` — balance + per-host usage
- `quotapot_balance`
- `quotapot_cursor_usage`
- `quotapot_codex_usage`
- `quotapot_usage_models` — per-model today / 7d / 30d

## Configuration

Everything is optional. Common fields: `lowBalanceThreshold`, `dailyTokenLimit`, `diskThresholdGB` (also editable in the Space tab).

Full fields, API key sources, security, compatibility and uninstall: **[docs/CONFIG.en.md](docs/CONFIG.en.md)**.

DeepSeek key for MCP hosts:

```sh
mkdir -p ~/.quotapot
printf '{"deepseekApiKey":"sk-..."}\n' > ~/.quotapot/config.json
chmod 600 ~/.quotapot/config.json
```

## Limits

- Cursor usage comes from the undocumented `api2.cursor.sh` and can break.
- Codex only counts local sessions that record `token_count`.
- WorkBuddy exposes credits; ZCode exposes plan entitlement; Claude/Trae desktop have no local usage.

## Docs

- [Configuration, security, compatibility, development, uninstall](docs/CONFIG.en.md)
- [Troubleshooting](docs/TROUBLESHOOTING.en.md)
- [Multi-host plugins](agents/README.md)
- [Changelog](CHANGELOG.md)

## License

MIT. QuotaPot is an independent community project, not an official DeepSeek product.

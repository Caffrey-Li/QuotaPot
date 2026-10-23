# QuotaPot for Cursor and Codex

Two hosts, one shared core. The DSH web plugin in the repository root is unchanged.

## Cursor

**Installed locally already** as `caffrey-li.quotapot`. Build/install again with:

```sh
cd agents/cursor-extension
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
  --install-extension "$PWD/quotapot-0.1.0.vsix"
```

Reload Cursor (**Developer: Reload Window**), then:

- Status bar: `QuotaPot ¥34.21 · C 78% · X 60%`
- Click it to open the panel with DeepSeek balance, Cursor plan/usage and Codex tokens/rate limits.
- The panel has the QuotaPot whale: it floats on the wave, breaches periodically, splashes on exit/entry, spouts, and breaches once when clicked.
- Run **QuotaPot: Set DeepSeek API Key** to store the key in Cursor SecretStorage.
- `QuotaPot: Open Cursor Usage Dashboard` opens the official page.

Cursor usage uses the same **undocumented** `api2.cursor.sh` dashboard API as the existing Cursor Usage extension. It reads `cursorAuth/accessToken` from `state.vscdb` with the system `sqlite3` command. It can break when Cursor changes the API.

## Codex

Codex plugins are MCP servers, not UI extensions. This one exposes tools:

- `quotapot_status` — DeepSeek + Cursor + Codex
- `quotapot_balance` — DeepSeek
- `quotapot_cursor_usage` — Cursor
- `quotapot_codex_usage` — local Codex sessions

Already appended to `~/.codex/config.toml` (a backup is next to it):

```toml
[marketplaces.quotapot-local]
source_type = "local"
source = "/Users/caffrey/.dsh/bot/workspace/dsh-bot-QuotaPot/agents/codex-marketplace"

[plugins."quotapot@quotapot-local"]
enabled = true
```

Restart ChatGPT/Codex to load it. Then ask Codex:

> 用 QuotaPot 查一下 DeepSeek 余额、Cursor 用量和 Codex 用量。

### DeepSeek key for Codex

The GUI app does not inherit shell environment variables reliably. Either export `DEEPSEEK_API_KEY` where Codex starts, or create a private file:

```sh
mkdir -p ~/.quotapot
printf '{"deepseekApiKey":"sk-..."}\n' > ~/.quotapot/config.json
chmod 600 ~/.quotapot/config.json
```

The Codex plugin's `.mcp.json` uses an absolute Node path (`/Users/caffrey/.hermes/node/bin/node`) because GUI apps often miss the shell PATH. If you move this plugin to another machine, replace it with `which node`.

## Honest limits

- **Cursor** has no official personal usage API. The number comes from its private dashboard endpoint and can disappear without notice.
- **Codex** only sees sessions under `~/.codex/sessions/**/*.jsonl`. Sessions that do not record `token_count` events are ignored, so "today" can legitimately be 0 even when you used Codex.
- **Cursor** has the animated whale in its panel. **Codex** has no UI, so no whale there; its plugin is tools only.

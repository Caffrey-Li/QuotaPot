# QuotaPot for Cursor

Cursor / VS Code extension half of QuotaPot.

- Status bar: DeepSeek balance, Cursor remaining quota, Codex 5h usage.
- Panel: animated QuotaPot whale above the cards; per-currency DeepSeek balance, Cursor plan/remaining/cycle, local Codex tokens and rate limits.
- The whale floats, breaches periodically, splashes, spouts, and breaches once when clicked.
- DeepSeek key is stored with `context.secrets`; set it from **QuotaPot: Set DeepSeek API Key**.
- Cursor usage uses the same undocumented dashboard API as the existing Cursor Usage extension. It reads `cursorAuth/accessToken` from `state.vscdb` with `sqlite3`; it may break when Cursor changes the API.
- Codex usage comes from local `~/.codex/sessions/**/*.jsonl`; sessions that do not record `token_count` events are ignored.

## Build

```sh
cd agents/cursor-extension
npx --yes @vscode/vsce package --no-dependencies
```

Install `quotapot-0.1.0.vsix` in Cursor: **Extensions → Install from VSIX…**.

## Notes

This is not a Cursor-official product. The Cursor endpoint is undocumented. The extension never sends the Cursor token anywhere except `api2.cursor.sh`.

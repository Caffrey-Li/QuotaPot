# QuotaPot for Codex

Codex plugins are MCP servers, so this target exposes tools rather than a floating widget:

- `quotapot_status` — DeepSeek balance + Cursor usage + Codex usage
- `quotapot_balance` — DeepSeek balance
- `quotapot_cursor_usage` — Cursor current-period usage
- `quotapot_codex_usage` — local Codex token totals and rate limits

`DEEPSEEK_API_KEY` must be present in the environment when Codex starts for the balance tools.

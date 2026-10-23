# Changelog

## 0.2.0 — 2026-10-23

- Usage tab in the panel: today / 7 days / 30 days.
- Total and per-Bot token usage from DS Bot's `usage.sqlite` (input + cache + output).
- Session span per Bot (first call to last call in the range) and a total span sum.
- `dailyTokenLimit`: daily token threshold; the pill turns red and shows a badge
  when today's total reaches it.
- Whale pet on the card: it floats at the surface, breaches out of the water in an
  arc and dives back while a Bot turn is running, and spouts at random intervals
  when it surfaces; one click sends it on a single breach. A card-width wave sits
  above the card's top edge with faded ends, and the surfboard was removed.
- `auto` locale now picks Chinese by Chinese time zones or Chinese system
  languages, then falls back to the DSH UI language and English.
- Read-only SQLite access through `node:sqlite`; no schema writes.

## 0.1.0 — 2026-10-22

- First public release.
- Floating DeepSeek balance pill for DSH Web and DS Bot (desktop and web).
- Reads `DEEPSEEK_API_KEY` through DSH's credential service, with environment
  variable and `~/.dsh/.credentials.yaml` fallbacks.
- Low-balance warning with a configurable threshold.
- Multiple currencies from the official `/user/balance` payload.
- Token-protected same-origin balance route; the API key never reaches the page.
- Configurable refresh interval, position, locale, API base URL and key variable.
- Zero runtime dependencies, no client build step.

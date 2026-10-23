# Changelog

## 0.3.2 — 2026-10-23

- Added WorkBuddy credits, ZCode plan entitlement, and an explicit "no local
  usage" state for Claude and Trae in a new Agents tab.
- Added WorkBuddy, ZCode, Claude and Trae data folders to Space, with safe
  cache subfolders and user-data rows kept read-only.
- Space now shows every scanned row; the threshold only highlights.
- The Cursor extension 0.2.0 adds the same Other AI tools section and hides the
  Cursor-only card when running in Trae.

## 0.3.1 — 2026-10-23

- The Space tab now has an inline threshold field; it filters the list and the
  "over" tag without changing the server-side scan. The value is persisted in
  the browser.
- The `diskThresholdGB` config remains the default.
- Cursor extension: compact side-bar view with the animated whale, plus
  configurable DeepSeek / Cursor / Codex warning thresholds.

## 0.3.0 — 2026-10-23

- Version check against GitHub Releases, an update banner, and one-click install
  through DSH's plugin manager. The new version loads after a DSH restart.
- New Space tab: scans known AI tool folders, shows AI data over 3GB and safe
  cache folders, and lets you select caches to delete.
- Cleanup is restricted to a server-side whitelist. Sessions, projects, settings,
  Cursor snapshots/globalStorage and `~/.dsh` data are shown read-only and are
  never deleted.
- New `diskThresholdGB` option (default 3).

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

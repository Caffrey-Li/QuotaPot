# Changelog

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

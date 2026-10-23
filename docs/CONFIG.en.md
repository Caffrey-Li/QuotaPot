# Configuration and operation

[← Back to README](../README.en.md)

## Install notes

### DSH CLI (Web profile)

```sh
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add github:Caffrey-Li/dsh-bot-QuotaPot#v0.4.1
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

The desktop profile is managed by the app; use the Plugins page instead.

### DSH offline install

Download `dsh-bot-quotapot-0.4.1.tgz` from [Releases](https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases), then choose the local file in the Plugins page.

### MCP offline install

Download `dsh-bot-quotapot-mcp-0.4.1.tgz` and replace `--package` in the template with its absolute path.

## Configuration

All fields are optional; put them in the profile's `cordis.patch.yml`:

```yaml
- id: quotapot
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    refreshSeconds: 30
    lowBalanceThreshold: 5
    dailyTokenLimit: 2000000
    diskThresholdGB: 3
    position: bottom-right
    locale: auto
```

| Field | Default | Notes |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Environment variable holding the key |
| `baseUrl` | `https://api.deepseek.com` | Custom gateway/proxy |
| `refreshSeconds` | `30` | Poll interval, 10–600s |
| `lowBalanceThreshold` | `5` | Warn below this amount; `0` disables |
| `dailyTokenLimit` | `0` | Daily token cap (cache included); `0` disables |
| `diskThresholdGB` | `3` | Space tab highlight threshold; editable in the UI |
| `position` | `bottom-right` | `bottom-right` / `bottom-left` / `top-right` / `top-left` |
| `locale` | `auto` | System language/time zone; or `zh` / `en` |

## Usage and thresholds

- Today / 7 days / 30 days
- Total and per-Bot tokens, session spans
- Session span = first to last call in the range, including idle time
- Daily cap counts `input + cache_read + cache_write + output`
- The pill turns red and shows `LIMIT` above the cap

Usage is read-only from `~/.dsh/bot/usage.sqlite`. Cache reads are included in the total.

![Usage screenshot](screenshot-usage.png)

## Where the API key comes from

1. Environment variable `apiKeyEnv` (default `DEEPSEEK_API_KEY`)
2. DSH credential store (`ctx.credentials`)
3. `refs.DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml`

For MCP hosts, use `~/.quotapot/config.json`:

```sh
mkdir -p ~/.quotapot
printf '{"deepseekApiKey":"sk-..."}\n' > ~/.quotapot/config.json
chmod 600 ~/.quotapot/config.json
```

## Security

- Balance/usage routes require a per-process random token injected into the page
- Unauthorized requests get 401 and no balance
- The API key never appears in the page, responses or logs
- Only `GET baseUrl/user/balance` is called; no telemetry
- Listens on `127.0.0.1` like DSH

## Compatibility

| Item | Version |
|---|---|
| DSH Web / Desktop | tested with `0.2.0-rc.2` and `0.2.1-rc.2` |
| DS Bot | 0.1.x / 0.2.x |
| Node.js | `>=22.19.0` |
| Platforms | macOS / Windows / Linux |
| Usage data | DS Bot 0.2.x `usage.sqlite` |

## Development

```sh
node --check index.js
node --check widget.js
npm test
```

No runtime dependencies; tests use Node's `node:test`.

## Uninstall

Settings → Plugins → disable/remove QuotaPot. It writes no business data and leaves no balance or key behind.

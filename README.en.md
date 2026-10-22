# QuotaPot

> A floating DeepSeek balance pill for DSH and DS Bot, with a low-balance warning.

QuotaPot is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin for **DSH Web, DS Bot Desktop and DS Bot Web**. It shows a draggable balance pill in the corner of the window, backed by DeepSeek's official `GET /user/balance` endpoint.

![QuotaPot screenshot](docs/screenshot.png)

## Features

- **Always visible** — a draggable pill in a corner; its position is remembered
- **Auto refresh** — every 30 seconds by default, and when the window regains focus
- **Top-up / granted split** — open the pill for the breakdown and update time
- **Low-balance warning** — the dot turns red and a `LOW` badge appears below the threshold
- **Multiple currencies** — all currencies returned by the API are listed; CNY is preferred in the pill
- **Chinese and English** — follows the browser language, or set it explicitly
- **Zero dependencies, no build step** — just `index.js` and `widget.js`
- **The key never reaches the page** — only the host process reads it

## Install

> Requires DSH `0.2.0-rc.2` or newer and Node `22.19+`.

### 1. DSH Plugins page (recommended)

Open **Settings → Plugins → Add plugin**, then enter:

```text
github:Caffrey-Li/dsh-bot-QuotaPot#v0.1.0
```

After the npm release is published, you can use the package name instead:

```text
dsh-bot-quotapot
```

Restart DSH completely if it says the change takes effect at the next start.

### 2. CLI (DSH Web profile)

```sh
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add github:Caffrey-Li/dsh-bot-QuotaPot#v0.1.0
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

> The Desktop profile is managed exclusively by the desktop app; use the Plugins page there.

### 3. Offline `.tgz`

Download `dsh-bot-quotapot-0.1.0.tgz` from [Releases](https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases) and install it from the Plugins page.

## Configuration

Everything is optional. Add this to the profile's `cordis.patch.yml`:

```yaml
- id: quotapot
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    refreshSeconds: 30
    lowBalanceThreshold: 5
    position: bottom-right
    locale: auto
```

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Environment variable holding the key |
| `baseUrl` | `https://api.deepseek.com` | Custom gateway/proxy; a trailing slash is fine |
| `refreshSeconds` | `30` | Poll interval, clamped to 10–600 seconds |
| `lowBalanceThreshold` | `5` | Warn below this amount; `0` disables it |
| `position` | `bottom-right` | `bottom-right` / `bottom-left` / `top-right` / `top-left` |
| `locale` | `auto` | `auto` / `zh` / `en` |

## Where the API key comes from

In order:

1. The environment variable named by `apiKeyEnv` (default `DEEPSEEK_API_KEY`)
2. DSH's credential service (`ctx.credentials`, supports rotation and the OS keychain)
3. `refs.DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml`

If DeepSeek is already configured under **Settings → Models**, you usually do not need to add anything.

## Security

- `/quotapot/balance` requires a per-process random token injected into the page; no token, no balance
- The API key never appears in the page, a response, or a log
- The only outbound request is `GET {baseUrl}/user/balance`
- The server still listens on `127.0.0.1` only; if you expose DSH on a LAN, the widget is exposed with the rest of the UI

## Compatibility

| Item | Version |
|---|---|
| DSH Web / Desktop | tested with `0.2.0-rc.2` and `0.2.1-rc.2` |
| DS Bot | 0.1.x / 0.2.x (as a host plugin) |
| Node.js | `>=22.19.0` |
| Platforms | macOS / Windows / Linux |

## Troubleshooting

**No pill**

1. Hard refresh (`Cmd/Ctrl + Shift + R`)
2. Check the plugin is enabled under Settings → Plugins
3. `GET /quotapot/widget.js` should return JavaScript; a 404 means the host plugin did not load — restart DSH

**`Balance --` / `NO_KEY`**

No key was found. Set `DEEPSEEK_API_KEY`, or configure DeepSeek under Settings → Models.

**`API key rejected or expired`**

The key was refused. Check it and the account status on the DeepSeek platform.

**`Reload the page and try again` after a DSH restart**

The process token changed. Reload the page.

**Another balance plugin is installed**

Routes and globals are namespaced with `quotapot`, so they do not collide. If both pills show, remove one.

## Development

```sh
node --check index.js
node --check widget.js
npm test
```

No runtime dependencies; tests use Node's built-in `node:test`.

## Uninstall

Settings → Plugins → disable or remove QuotaPot. The plugin stores no business data.

## License

MIT. QuotaPot is an independent community project, not an official DeepSeek product. DeepSeek is a trademark of its owner.

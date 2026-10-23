# Troubleshooting

[← Back to README](../README.en.md)

## The pill is missing

1. Hard refresh (`Cmd/Ctrl + Shift + R`)
2. Check Settings → Plugins
3. Open `http://127.0.0.1:<port>/quotapot/widget.js`; a 404 means the host plugin did not load — restart DSH

## `Balance --` / `NO_KEY`

No key found. Set `DEEPSEEK_API_KEY` or configure DeepSeek in Settings → Models.

## `API key invalid or expired`

The key was rejected. Check it and the account balance on the DeepSeek platform.

## `Reload the page` after restarting DSH

The per-process token rotated; refresh the page.

## The Usage tab is empty

DS Bot has not written `usage.sqlite` yet, or Node is below 22.19 (`node:sqlite` missing). Chat a few turns first; if it stays empty, check `~/.dsh/bot/usage.sqlite`.

## Two balance pills

Routes and globals are prefixed with `quotapot`; they do not conflict. Uninstall the other pill.

## MCP host cannot connect

Verify this command starts:

```sh
npx -y --package https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases/download/v0.4.1/dsh-bot-quotapot-mcp-0.4.1.tgz quotapot-mcp
```

The first launch downloads the package; set the host MCP startup timeout to 60s. If GitHub is blocked, use the offline `.tgz` absolute path.

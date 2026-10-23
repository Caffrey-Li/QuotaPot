# 故障排查

[← 返回 README](../README.md)

## 胶囊没出现

1. 强制刷新页面（`Cmd/Ctrl + Shift + R`）
2. 确认插件已启用：设置 → 插件
3. 访问 `http://127.0.0.1:<port>/quotapot/widget.js`，应返回 JS；404 说明宿主插件没加载，重启 DSH

## 显示 `余额 --` / `NO_KEY`

没有找到 Key。检查 `DEEPSEEK_API_KEY`，或在 设置 → 模型 里配置 DeepSeek。

## 显示 `API Key 无效或已过期`

Key 被拒绝。到 DeepSeek 开放平台确认 Key 和余额状态。

## DSH 重启后显示 `请刷新页面`

进程级 token 变了，刷新页面即可。

## 用量标签是空的

DS Bot 还没有写入 `usage.sqlite`，或当前 Node 不支持 `node:sqlite`（需要 22.19+）。先正常聊几轮再打开；如果一直为空，检查 `~/.dsh/bot/usage.sqlite`。

## 同时装了别的余额插件

路由和全局变量都带 `quotapot` 前缀，不会冲突；如果两个胶囊都显示，卸载其中一个。

## MCP 宿主连不上

先确认这条命令能启动：

```sh
npx -y --package https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases/download/v0.4.1/dsh-bot-quotapot-mcp-0.4.1.tgz quotapot-mcp
```

首次启动会下载包，宿主启动超时建议设 60 秒。GitHub 访问受限时，改用离线 `.tgz` 的绝对路径。

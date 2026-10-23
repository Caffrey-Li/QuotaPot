# 配置与运维

[← 返回 README](../README.md)

## 安装补充

### DSH 命令行（Web profile）

```sh
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add github:Caffrey-Li/dsh-bot-QuotaPot#v0.4.1
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

Desktop profile 由桌面 App 独占管理，命令行会拒绝；请用插件页面。

### DSH 离线安装

从 [Releases](https://github.com/Caffrey-Li/dsh-bot-QuotaPot/releases) 下载 `dsh-bot-quotapot-0.4.1.tgz`，在插件页面选择本地文件安装。

### MCP 离线安装

下载 `dsh-bot-quotapot-mcp-0.4.1.tgz` 后，把模板里的 `--package` 换成该文件的绝对路径：

```json
{
  "command": "npx",
  "args": ["-y", "--package", "/ABSOLUTE/PATH/dsh-bot-quotapot-mcp-0.4.1.tgz", "quotapot-mcp"]
}
```

## 配置

所有配置都可选。写进 profile 的 `cordis.patch.yml`：

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

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 读取 Key 的环境变量名 |
| `baseUrl` | `https://api.deepseek.com` | 自定义网关/代理地址 |
| `refreshSeconds` | `30` | 轮询间隔，10–600 秒 |
| `lowBalanceThreshold` | `5` | 低于该金额提醒；`0` 关闭 |
| `dailyTokenLimit` | `0` | 每天 token 上限（含缓存）；`0` 关闭 |
| `diskThresholdGB` | `3` | 空间页“超过”阈值，也可在页面直接改 |
| `position` | `bottom-right` | `bottom-right` / `bottom-left` / `top-right` / `top-left` |
| `locale` | `auto` | 按系统语言/时区自动；或 `zh` / `en` |

## 用量与阈值

点胶囊 → **用量**：

- 今日 / 7 天 / 30 天
- 全部 Bot 与每个 Bot 的 token、会话跨度
- 会话跨度 = 范围内第一次到最后一次调用的时间差，包含空闲时间
- 每日阈值按 `input + cache_read + cache_write + output` 计算
- 超过阈值后胶囊变红并显示 `超`

数据只读自 `~/.dsh/bot/usage.sqlite`。缓存读取也计入总量，所以数字通常比“输入 + 输出”大。

![用量截图](screenshot-usage.png)

## API Key 从哪里来

按顺序尝试：

1. 环境变量 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）
2. DSH 凭据存储（`ctx.credentials`，支持轮换和 keychain）
3. `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`

Key 需要能调用 DeepSeek 开放平台。如果 DSH 的 **设置 → 模型** 里已配置 DeepSeek，通常不需要再填。

MCP 宿主使用 `~/.quotapot/config.json`：

```sh
mkdir -p ~/.quotapot
printf '{"deepseekApiKey":"sk-..."}\n' > ~/.quotapot/config.json
chmod 600 ~/.quotapot/config.json
```

## 安全

- 余额/用量路由只接受进程级随机 token；token 由页面注入，不落盘
- 未授权请求返回 401，不返回余额
- API Key 不出现在页面、响应或日志
- 只向 `baseUrl` 的 `/user/balance` 发 GET，无遥测
- 和 DSH 一样只监听 `127.0.0.1`；如果通过前门暴露到局域网，余额也会随 UI 可见

## 兼容性

| 项目 | 版本 |
|---|---|
| DSH Web / Desktop | `0.2.0-rc.2`、`0.2.1-rc.2` 实测 |
| DS Bot | 0.1.x / 0.2.x |
| Node.js | `>=22.19.0` |
| 平台 | macOS / Windows / Linux |
| 用量数据 | 需要 DS Bot 0.2.x 的 `usage.sqlite` |

## 开发

```sh
node --check index.js
node --check widget.js
npm test
```

仓库没有运行时依赖，测试使用 Node 自带 `node:test`。

## 卸载

设置 → 插件 → 停用/移除 QuotaPot。插件不写业务数据，卸载后不会留下余额或 Key。

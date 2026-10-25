# DSH / DS Bot 端口

端口 id：`dsh`。第一版只支持 macOS。

## 读取的本地文件和凭据

| 来源 | 用途 | 方式 |
| --- | --- | --- |
| `$DSH_HOME` 或 `~/.dsh` | 发现安装、磁盘目标 | 存在性判断，不读大文件 |
| `~/.dsh/bot/usage.sqlite` | 用量、模型、会话 | `ports/sqlite.mjs` 的 `openRead` 只读 |
| `~/.dsh/.credentials.yaml` | 余额 API Key 的兜底 | 解析 `refs.DEEPSEEK_API_KEY`，不打印 |
| `~/.dsh/AGENTS.md` | 核实指令文件约定 | 只用于确认 `AGENTS.md`，适配器不读正文 |
| `~/.dsh/cache`、`storages/session_projcache`、`logs`、`attachments/v1/tmp` | 可重建缓存 | 磁盘槽，默认标可清 |

DSH Desktop 和 Web 共用 `~/.dsh`；`DSH_HOME` 可覆盖。

`calls` 表结构已用本机数据库确认：`key, session, time, provider, model, kind, live, input, cache_read, cache_write, output`。**没有时长列**，因此模型耗时统一为 `null`，界面显示「无耗时」。`owners` 表提供 `session, owner, name`，用来按 Bot/群/Agent 分组。

## 八个槽

| 槽 | 状态 | 说明 |
| --- | --- | --- |
| 发现 | 做到 | `$DSH_HOME` 或 `~/.dsh` 存在即安装；`home` 显示为 `~/.dsh` |
| 用量 | 做到 | 今日 / 7 天 / 30 天，单位 **token**；按模型、Bot、会话分组；`input + cache_read + cache_write + output` |
| 模型 | 做到（子项降级） | 列出 `calls` 里出现过的模型和用量；**无状态**，`statusText` 为「无状态」；**无耗时**，`speed:null` |
| 对话 | 降级 | `calls.session` 能算会话用量，但没有上下文窗口和压缩记录，无法算 80% 比例；为了不显示假的 0%，整个槽降级，`capabilities.chats:false`。会话列表仍可通过 `usage().sessions` 和 `headers()` 取得 |
| 动作 | 全部降级 | 打开、开新没有稳定深链/CLI；放入输入框只复制到剪贴板。`capabilities.actions` 全为 false |
| 提示词 | 做到 | `AGENTS.md`；无压缩命令；`hasContext:false`，不写上下文百分比和「压缩 0 次」 |
| 磁盘 | 做到 | `~/.dsh` 标只读（用户数据）；`cache`、`session_projcache`、`logs`、`attachments/v1/tmp` 标可清 |
| 菜单 | 做到 | DeepSeek `/user/balance`，单位 **currency**，显示为「余额 ¥x」；没有 Key 时降级 |

### 用量结果

`usage(days)` 返回：

```js
{
  ok: true, source: 'dsh', unit: 'token', days, since, todayStart,
  tokens, calls, input, cacheRead, cacheWrite, output,
  models: [...], owners: [...], sessions: [...],
  truncated: false, updatedAt
}
```

`models` 的每一项有 `model / provider / tokens / calls / input / cacheRead / cacheWrite / output / lastAt`，可直接给用量页渲染。

`owners` 有 `key / name / kind / tokens / calls / first / last / spanMs`；`kind` 由 `owner` 前缀推成 `bot / group / agent / other`。`spanMs` 是所选范围内第一次到最后一次调用的墙钟跨度，包含空闲时间。

### 模型结果

```js
{
  ok: true,
  headline: 'N 个模型',
  note: '来自 DS Bot 本地 calls 表；没有模型状态和生成耗时。',
  models: [{ name, vendor, status: 0, statusText: '无状态', detail, speed: null, tokens, calls, lastAt }]
}
```

### 对话为什么降级

DSH 的 `calls` 只有调用时间和 token，没有上下文窗口、压缩次数或每次调用的上下文占用。返回 `measured:false` 仍会让现有 UI 显示 0%，所以这里直接返回：

```text
DSH 的 calls 表没有上下文窗口和压缩记录，无法计算 80% 阈值；这条端口不显示对话比例。
```

会话 token 总量仍在 `usage().sessions` 和 `headers()` 中，不丢数据。

## 提示词

```js
promptProfile = {
  product: 'DS Bot',
  instructionsFile: 'AGENTS.md',
  compactCommand: '',
  hasContext: false,
  warnPercent: 80,
}
```

`AGENTS.md` 不是默认猜的：本机 DSH 的 `agent-instructions` 插件在 `~/.dsh/profiles/desktop/cordis.patch.yml` 中启用，生效内容是全局 `~/.dsh/AGENTS.md` 加项目根到工作目录的 `AGENTS.md` 链。`CLAUDE.md` 是兼容读取，不改变 DSH 自己的核心文件。

DSH 没有找到面向用户的 `/compact` 命令；自动压缩不是可执行命令，所以 `compactCommand` 留空，整理提示词不会多出压缩命令那一行。

## 动作

| 动作 | 结果 |
| --- | --- |
| `open({chatId})` | `{ ok:false, error:'DSH 没有稳定的会话深链，已降级' }` |
| `paste({text})` | 复制到剪贴板，返回 `{ ok:true, copied:true, placed:false, note }`；`capabilities.actions.paste:false`，界面不显示「整理」 |
| `spawn({text})` | `{ ok:false, error:'DSH 没有带提示词开新会话的 CLI 或深链，已降级' }` |

验收时没有真的打开、写入或开新会话；只验证了降级返回。

## 菜单

读取顺序：

1. 环境变量 `DEEPSEEK_API_KEY`
2. `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`

如果这个 ref 是 `keychain:` / `secret:` / `op:` / `vault:` 形式，端口没有 DSH 的凭据服务上下文，会降级为「没有找到 DeepSeek API Key」，不会尝试破解钥匙串，也不会打印 Key。

返回示例：

```js
{
  ok: true, unit: 'currency', currency: 'CNY',
  amount: 12.34, balance: 12.34,
  display: '余额 ¥12.34',
  isAvailable: true, balances: [...], updatedAt
}
```

没有 Key、401/403、429、网络错误都会返回中文 `degrade` 原因。余额永远不会被放进 `unit:'token'`。

## 注册表

由合并的人把这一行加进 `ports/registry.mjs`：

```js
import * as dsh from './dsh/index.mjs'
```

并把数组改成：

```js
export const ports = [cursor, dsh]
```

本端口没有改 `ports/registry.mjs`。

## 自检

```sh
node ports/dsh/check.mjs
```

结果：

```text
dsh port check ok
```

`check.mjs` 只读 `fixtures/`：

- `fixtures/usage.json`：脱敏的调用小样本（假 session、假 owner、真实表结构/模型名）
- `fixtures/credentials.yaml`：假 Key `sk-demo-only-not-real`
- `fixtures/balance.json`：假余额 `12.34`
- `fixtures/home/`：只用于发现测试

检查会在临时目录用 fixture 建一个 SQLite，再用 `openRead` 读；验证了今日/7 天/30 天、模型、会话、只读拒绝、单位、提示词、降级、菜单格式，没有读取本机真实 DSH 数据，也不发网络请求。

`node desktop.mjs --check` 目前仍只跑 Cursor（注册表还没加 dsh），加完注册表后会一起跑 `ports/dsh/check.mjs`。

## 本机验收

```text
node ports/dsh/check.mjs        -> dsh port check ok
node desktop.mjs --check        -> cursor port check ok / quotapot self-check ok（尚未注册 dsh）
```

对真实 `~/.dsh` 的只读抽查：

- `usage(1)` 返回 `ok:true, unit:'token'`，当日有真实调用
- `models()` 返回 3 个本地出现过的模型，都是「无状态 / 无耗时」
- `headers()` 返回 9 条会话
- `menu()` 返回 `unit:'currency'`，`display` 以「余额 ¥」开头
- `chats()` 按设计降级

## 限制

- 没有模型状态字段，统一显示「无状态」。
- 没有调用时长字段，`speed` 一律 `null`。
- 没有上下文窗口/压缩来源，对话比例槽降级。
- 打开、开新、写入输入框没有做，只保留复制。
- 余额只支持默认 `https://api.deepseek.com`；自定义 `baseUrl` 可临时用 `DEEPSEEK_BASE_URL`，不读 profile 配置。
- 钥匙串形式的 Key 不解析，直接降级。
- 第一版只支持 macOS。

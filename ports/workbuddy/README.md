# 端口：workbuddy（WorkBuddy）

> 2026-10-26 精简：去掉了模型列表、`menu()`、`spawn()` 和 `diskTargets()`（磁盘目录统一在 `disk.mjs`）。能力为 `{ usage (积分), chats, actions: { open, paste: 'copy' } }`，整理流程是「复制整理 → 复制继承」，点对话条用 `workbuddy://chat/<id>` 打开。下文的槽位表保留作开发记录。

只新增了 `ports/workbuddy/`，没有改 `desktop.mjs`、`ui/index.html`、`native/`、`ports/registry.mjs`、`ports/cursor/` 或其他端口目录，也没有 git commit。

## 注册表要加的那一行（交给合并的人）

`ports/registry.mjs`：

```js
import * as workbuddy from './workbuddy/index.mjs'
export const ports = [cursor, workbuddy]
```

## 读了哪些本地文件

| 文件 | 用途 | 打开方式 |
| --- | --- | --- |
| `~/.workbuddy/workbuddy.db` | 唯一数据源。`session_usage`（used / size / updated_at / credit_json）和 `sessions`（id / title / custom_title / model / cwd / created_at / updated_at） | `ports/sqlite.mjs` 的 `openRead`（`readOnly: true`），没有用 sqlite3 命令行 |
| `~/Library/Application Support/WorkBuddy/` 下的 GPUCache、DawnGraphiteCache、DawnWebGPUCache、Cache、Code Cache、logs | 磁盘槽，逐个确认存在 | 只取路径，不读写 |
| `~/Library/Application Support/QuotaPot/snapshot.json` | `peekUsage` / `peekContext` 的快照，写在 `snapshot().workbuddy` 下 | `ports/snapshot.mjs` |

没有读任何凭据：`keyblob`、`.neodata_token`、`models.json`（里面有明文 API Key）都没有碰。没有钥匙串访问，没有网络请求，`import` 本模块没有任何副作用。

不读 `~/.workbuddy/models.json` 是故意的：那是用户自建模型列表，每个条目带明文 `apiKey`，读它就要承担泄漏风险，而模型槽用 `sessions.model` 已经够用。

## 八个槽：做到还是降级

| 槽 | 结果 | 说明 |
| --- | --- | --- |
| 发现 | 做到 | `~/.workbuddy/workbuddy.db` 存在即已安装，`home` 返回 `~/.workbuddy` |
| 用量 | 做到，单位 **credits** | `session_usage.credit_json` 的值相加。**不是 token**，界面显示「N 积分」 |
| 模型 | 做到，状态降级，无耗时 | 模型来自 `sessions.model`；`status: 0` + `statusText: '本地记录'`（本地没有任何降级/停用标记，不敢冒充「正常」）；`speed: null` |
| 对话 | 做到；压缩和增幅降级 | 上下文比例是真实值（`used / size`）。本地没有按时间的上下文采样，所以 `measured: false`、`compactions/lostRatio/growth` 全是 `null`，不写「压缩 0 次」 |
| 动作 | 打开做到；放入输入框、开新降级 | 见下 |
| 提示词四条 | 做到 | 指令文件 `CODEBUDDY.md`，压缩命令 `/compact`，`hasContext: true` |
| 磁盘 | 做到 | `~/.workbuddy` 标只读；六个缓存/日志目录标可清 |
| 菜单 | 降级 | 本地没有套餐额度 |

### 动作

- **打开会话（做到）**：`workbuddy://chat/<会话 id>`。这是 WorkBuddy 自己注册的 URL scheme（`/Applications/WorkBuddy.app/Contents/Info.plist` 的 `CFBundleURLSchemes = workbuddy`），主进程 `DeepLinkRouter` 和渲染进程都在用它跳转会话，应用没启动时会带着这个 URL 启动。用 `open -g` 打开，不抢焦点。
- **放入输入框（降级）**：WorkBuddy 没有写入输入框的 URL scheme、命令行或数据库字段。本地只有一条 `POST /sessions/<id>/inject`，那是往会话历史里插一整轮 user+assistant 对话，属于伪造记录，不做。所以 `capabilities.actions.paste = false`，`paste()` 只把文本复制到剪贴板并返回中文原因。
- **开新对话（降级）**：`POST /sessions` 只能创建空会话（只接受 cwd / mode / model，没有 prompt 字段）；能把提示词送进去的 `POST /chat/<会话>` 会**立刻执行一轮**并消耗额度，不是「开新等用户输入」。所以 `capabilities.actions.spawn = false`，`spawn()` 把继承提示词复制到剪贴板后返回中文原因。

验收时没有真的执行这三个动作：只验证了 `workbuddyChatUrl()` 生成的链接、非法会话编号会被拒（不走到 `open`）、以及 `phase: 'done'` 直接返回。

### 指令文件名怎么定的

不是照抄 AGENTS.md。WorkBuddy 的应用包里写死的顺序是
``Tu=[`CODEBUDDY.md`,`.codebuddy/CODEBUDDY.md`,`AGENTS.md`]``，
渲染进程里「初始化项目并生成 CODEBUDDY.md」也是这个文件名。所以 `instructionsFile` 用 `CODEBUDDY.md`。
`/compact` 是产品里真实存在的斜杠命令（应用包里有 ``jo=new Set([`/compact`])``）。

## 字段口径和误差（重要）

- **`credit_json` 的键是请求 ID，不是模型名**：应用包里的写入代码是
  `d[l]=e+s`，`l` 取 `codebuddy.ai/requestId`，`s` 取 `cost.amount`。
  所以 credits **无法按请求拆到模型**，只能按会话归集：一条会话的 credits 全部算在它**最后一次**使用的模型上，中途换模型会算错到最后一个模型。`models()` 的 `note` 和 `detail` 里都写明了这一点。
- **用量分天有误差**：`session_usage` 每个会话只有一行，`updated_at` 是**最后更新时间**（毫秒，已核对，13 位）。一条跑了三天的会话，全部 credits 会记在最后更新那一天。所以「今日 credits」可能包含前几天那部分，跨天的长会话会整体落在一天里。UI 上看不出来，`usage().note` 和本文件都在说明。
- **`calls` 是请求数**：`credit_json` 的键数，不是会话数。会话数单独放在 `sessions` 字段。
- **`used` / `size` 是上下文 token 和窗口**：`size` 只在 192000 / 300000 / 168000 / 200000 / 1000000 这几个值里出现，`used` 恒小于 `size`（本机 534 行里没有一行 `used > size`），且和 `sessions.context_window` 对得上。比例 = `used / size`，不是估算。
- **上下文只有最后一个采样点**：`session_usage` 每个会话一行、只保留最新值，没有像 Cursor 那样按消息留存的时间序列，所以压缩次数和增幅根本算不出来，一律 `null`。
- **credits 只从某个版本开始记录**：本机 534 行里只有 69 行有 `credit_json`，更早的会话是空的，那部分用量拿不到，不会补 0 以外的数字。若整库都没有 credits，`usage()` 直接降级而不是返回 0。

## 本机验收结果

`node ports/workbuddy/check.mjs` → `workbuddy port check ok`（只依赖 fixtures，不依赖本机装了 WorkBuddy）。
`node desktop.mjs --check` → `quotapot self-check ok`（端口未注册，暂不纳入，与阶段 0 一致）。

验收时（2026-10-25）对本机真实数据的实测：

| 槽 | 实测 |
| --- | --- |
| discover | `{ ok: true, installed: true, home: '~/.workbuddy' }` |
| usage(1) | 58.66 credits · 1 个请求 · 1 个会话（hy4-preview） |
| usage(7) | 58.66 credits · 1 个请求 |
| usage(30) | 130.15 credits · 6 个请求 · 3 个会话 |
| models | 7 个模型，hy3（461 会话 / 1974.70 credits）、auto（59 / 1495.65）、kimi-k3-1（2 / 1009.43）… 全部 `speed: null` |
| chats | 503 条有上下文，1 条 ≥ 80%（85.5%，hy3，164106 / 192000），全部 `measured: false` |
| headers | 536 条会话 |
| prompts | 四条都出文本，交接提示词含「上下文大约已用 86%，窗口大约 16.4万 / 19.2万 token。」和「需要压缩时可以使用 /compact。」，没有出现「压缩 0 次」 |
| menu | 降级：WorkBuddy 的套餐额度在服务端，本地没有记录 |
| open | 非法编号返回「对话编号无效」且不会执行 `open`；合法编号生成 `workbuddy://chat/<uuid>`（未真的打开） |
| diskTargets | `~/.workbuddy` 只读；GPUCache / DawnGraphiteCache / DawnWebGPUCache / Cache / Code Cache / logs 可清，六个目录都已确认存在 |

## fixtures

- `fixtures/session-usage.json`：`session_usage` 四行脱敏样本（假会话 id、假请求 ID、合成时间戳）。
- `fixtures/sessions.json`：`sessions` 四行脱敏样本（假 id、示例标题、`/work/*` 假路径、真实模型 id）。
- `fixtures/prompts.json`：跑四条提示词用的对话样本。

脱敏去掉了：真实会话编号、真实请求 ID、真实会话标题、真实项目路径（含用户名）、邮箱和任何密钥。`check.mjs` 里有一条断言会检查 fixtures 不含 `sk-`、`@`、`/Users/`。

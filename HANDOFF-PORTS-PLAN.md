# QuotaPot 多端口功能清单与分工

本文件是规划，不是任务单。端口合同和 Cursor 适配器以 `HANDOFF-MAIN.md` 为准；本文件只在它完成之后生效。

标记：✅ 已有/可直接做　🟡 能做但要真机核实字段　⛔ 做不到，返回明确降级　❓ 未知，需要先查

## 一、共享层（所有端口共用，只做一次）

| # | 功能 | 现状 | 说明 |
|---|---|---|---|
| S1 | 端口合同 + 注册表 `ports/<id>/` | HANDOFF-MAIN 任务 | 八个槽：发现、用量、模型、对话、动作、提示词、磁盘、菜单 |
| S2 | 能力声明 `capabilities` | 缺 | 每个端口声明自己能做的槽和动作；界面按能力显示按钮，不靠端口名判断 |
| S3 | 统一降级结构 | 缺 | `{ ok:false, degraded:true, reason:'中文原因' }`；界面统一渲染成灰色说明，不填 0、不借别的端口数据 |
| S4 | 单位字段 | 缺 | 用量必须带 `unit`：`token` / `credits` / `percent` / `currency`。界面按单位格式化，禁止 credits、余额、百分比冒充 token |
| S5 | 提示词模板引擎 | 缺 | 四条骨架共用（复述目标、已完成、未完成、不能再改、不确定标出、停下）；端口只提供变量：产品名、指令文件名、压缩命令、上下文数据 |
| S6 | 端口切换 | HANDOFF-MAIN 任务 | 只显示「发现」返回已安装的端口；只有一个端口时界面与现在一致 |
| S7 | 每端口 fixture 自检 | 缺 | `ports/<id>/fixtures/` 放脱敏样本；`--check` 对每个端口跑解析测试，没装该软件的机器也能验证 |
| S8 | SQLite 读取改用 `node:sqlite` | 现用 `sqlite3` 命令行 | Windows 默认没有 `sqlite3`；跨平台前必须换 |
| S9 | 磁盘目标按端口合并 | 现在写在一处 | 每个端口导出自己的目录清单；`safe` 标记规则不变，阈值只高亮 |

## 二、各端口八个槽

### Cursor（参考实现，已完成）

| 槽 | 来源 | 状态 |
|---|---|---|
| 发现 | `state.vscdb` 存在 | ✅ |
| 用量 | `api2.cursor.sh` GetFilteredUsageEvents，单位 token，>3000 条截断说明 | ✅ |
| 模型 | ItemTable 模型目录，状态正常/降级/停用，速度「无耗时」 | ✅ |
| 对话 | `composerData` + 气泡采样，80% 阈值，压缩来自采样下跌 | ✅ |
| 动作 | 打开：临时快捷键 `canvas.openAgentByConversationId`；放入：写 composer 草稿；开新：`cursor://…/prompt?workspace=` 且 `open -g` | ✅ |
| 提示词 | 指令文件 `AGENTS.md` | ✅（迁到 `ports/cursor/`） |
| 磁盘 | Cursor 用户数据 + 5 个缓存目录 | ✅ |
| 菜单 | 本账期已用百分比（金额百分比，单位 percent） | ✅ |

### Claude（建议拆成 Claude Code 与 Claude 桌面版两个发现项，共用一个端口）

| 槽 | 来源 | 状态 |
|---|---|---|
| 发现 | `~/.claude/projects/` 存在 → Claude Code；`Claude.app` 存在 → 桌面版 | ✅ |
| 用量 | Claude Code：会话 jsonl 里 assistant 消息的 `message.usage`（input / output / cache_creation / cache_read），按 `message.id` 去重。桌面版：⛔ 本地无用量 | 🟡 |
| 模型 | 只能列出本地日志里出现过的 `message.model`；⛔ 无目录、无状态接口；速度「无耗时」（时间戳差值不等于生成耗时，不要用） | 🟡 |
| 对话 | 一个 jsonl 一条会话；上下文 = 最后一条 assistant 的 input+cache 总量 / 模型窗口；压缩：日志里有压缩边界记录（字段名待核实），没采样时不写次数 | 🟡 |
| 动作·打开 | 终端里 `claude --resume <id>`（cwd 设为原项目）；会激活终端，和 Cursor「不抢焦点」不同，需要你决定是否接受 | 🟡 |
| 动作·放入输入框 | ⛔ 没有写入草稿的接口；降级为「只复制」，不用 Cmd+V | ⛔ |
| 动作·开新 | 终端里 `claude "<提示词>"`，cwd 为原项目 | 🟡 |
| 提示词 | 指令文件 `CLAUDE.md`；整理提示可提到 `/compact` | ✅ |
| 磁盘 | `~/.claude`（用户数据，只读标记）；桌面版 Cache / GPUCache / DawnGraphiteCache（可清） | ✅ |
| 菜单 | ⛔ 无本地额度接口（订阅额度只在应用内显示） | ⛔ |

### Codex

| 槽 | 来源 | 状态 |
|---|---|---|
| 发现 | `~/.codex/sessions/` 存在 | ✅ |
| 用量 | rollout jsonl 的 `token_count` 事件（input / cached_input / output / reasoning），单位 token；未写 token_count 的会话不计，要说明 | ✅（旧核心已有） |
| 模型 | 会话里的模型名；⛔ 无目录、无状态；速度「无耗时」 | 🟡 |
| 对话 | 一个 rollout 一条会话；上下文 = 最近一次用量 / `model_context_window`（token_count 里有）；压缩事件字段待核实 | 🟡 |
| 动作·打开 | 终端 `codex resume <id>`，cwd 为原项目 | 🟡 |
| 动作·放入输入框 | ⛔ 降级为只复制 | ⛔ |
| 动作·开新 | 终端 `codex -C <项目> "<提示词>"` | 🟡 |
| 提示词 | 指令文件 `AGENTS.md`；压缩命令 `/compact` | ✅ |
| 磁盘 | `~/.codex`（用户数据，只读标记）；日志目录待确认能否列为可清 | 🟡 |
| 菜单 | `rate_limits` 5 小时 / 7 天窗口已用百分比，单位 percent，标明是窗口百分比 | ✅（旧核心已有） |

### DeepSeek Harness（DSH / DS Bot）

| 槽 | 来源 | 状态 |
|---|---|---|
| 发现 | `$DSH_HOME` 或 `~/.dsh` 存在 | ✅ |
| 用量 | `~/.dsh/bot/usage.sqlite` 的 `calls`（input / cache_read / cache_write / output），按 Bot 分组，单位 token | ✅（旧核心已有） |
| 模型 | 本地调用里出现过的模型；⛔ 无状态；耗时看 `calls` 是否有时长列，没有就「无耗时」 | 🟡 |
| 对话 | `calls.session` 可算每条会话用量；窗口大小、压缩记录 ❓ | ❓ |
| 动作 | DSH Web UI 是否有会话 URL、CLI 是否能带提示词开新 ❓；先全部降级 | ❓ |
| 提示词 | 指令文件名 ❓（先默认 `AGENTS.md`，核实后改） | ❓ |
| 磁盘 | `~/.dsh`（用户数据，只读标记） | ✅ |
| 菜单 | DeepSeek `/user/balance` 余额，单位 currency，必须写成「余额 ¥x」，不是 token；需要 API Key | ✅（旧核心已有） |

### WorkBuddy

| 槽 | 来源 | 状态 |
|---|---|---|
| 发现 | `~/.workbuddy/workbuddy.db` 存在 | ✅ |
| 用量 | `session_usage.credit_json`，单位 **credits**，今日 / 7 天 / 30 天 | ✅（旧核心已有） |
| 模型 | credit_json 的键若是模型名，可按模型分 credits；⛔ 无状态；「无耗时」 | 🟡 |
| 对话 | 有会话行，但 ⛔ 无上下文 token，不显示比例和压缩 | ⛔ |
| 动作 | ❓ 先全部降级 | ❓ |
| 提示词 | 指令文件名 ❓ | ❓ |
| 磁盘 | `~/.workbuddy`（只读）；Application Support/WorkBuddy 下 GPUCache / DawnGraphiteCache / Cache / Code Cache（可清） | ✅ |
| 菜单 | ⛔ 本地无剩余额度 | ⛔ |

### Grok Bot（xAI，云端 agent，2026-08 beta）

| 槽 | 来源 | 状态 |
|---|---|---|
| 发现 | 桌面应用安装路径 ❓ | ❓ |
| 用量 / 模型 / 对话 | Bot 运行在 xAI 云端机器上，本地未见用量数据 | ⛔ |
| 动作 | ⛔ | ⛔ |
| 提示词 | 可用（官方示例提到 `AGENTS.md`）；工具页只提供复制 | ✅ |
| 磁盘 | 应用缓存目录 ❓ | ❓ |
| 菜单 | ⛔ | ⛔ |

结论：Grok Bot 第一版只做「提示词端口」：只有工具页可用，其余槽全部降级。

## 三、提示词按端口的差异

四条骨架不变，端口只替换这些变量：

| 变量 | Cursor | Claude Code | Codex | DSH | WorkBuddy | Grok Bot |
|---|---|---|---|---|---|---|
| 产品名 | Cursor | Claude Code | Codex | DS Bot | WorkBuddy | Grok Bot |
| 指令文件 | AGENTS.md | CLAUDE.md | AGENTS.md | ❓ | ❓ | AGENTS.md |
| 压缩命令 | 无 | /compact | /compact | ❓ | ❓ | 无 |
| 上下文数字 | 有 | 有 | 有 | ❓ | 无 | 无 |
| 「整理」可写入草稿 | 是 | 否，只复制 | 否，只复制 | 否 | 否 | 否 |

没有上下文数字的端口，整理提示词里删掉「上下文大约已用 x%」这一行，不写 0。

## 四、发布到 GitHub 需要的额外工作（共享层之外）

| # | 功能 | 说明 |
|---|---|---|
| R1 | 跨平台路径表 | 每个端口给出 macOS / Windows / Linux 三套路径 |
| R2 | 去掉 macOS 专属调用 | `osascript`、`security`（钥匙串）、`pbcopy`、`open -g`；Windows 上 Cursor 密钥要走 DPAPI，Linux 走 libsecret |
| R3 | 窗口外壳 | `native/Window.swift` 只能用于 macOS；Windows / Linux 先用「浏览器打开本地页面」模式，或另选外壳 |
| R4 | macOS 签名与公证 | 未签名的 .app 会被 Gatekeeper 拦截 |
| R5 | Release 产物与安装脚本 | CI 打包、版本号统一、更新检查 |
| R6 | README 按端口写 | 每个端口：能显示什么、读取了哪些本地数据和凭据、降级项 |
| R7 | 与现有 GitHub 仓库的关系 | 仓库里现在是 DSH 插件、VSIX、MCP 三种形态；本地版是桌面应用、没有 MCP 和余额页。需要决定替换、并存还是分仓库 |

## 五、已定决定（2026-10-25）

- Claude 端口同时支持 Claude Code 命令行和 Claude 桌面版，一个端口两个来源。
- 第一版只发 macOS。第四节 R1、R2、R3 推迟到第二版；R4–R7 仍要做。
- 每个端口交给对应的 agent 在本机自己开发和验证。

## 六、分工与顺序

| 阶段 | 谁做 | 任务单 |
|---|---|---|
| 0 | Cursor | `HANDOFF-MAIN.md`，加上本文 S2–S5、S7、S8 |
| 1（并行） | Claude Code | `HANDOFF-PORT-claude.md` |
| 1（并行） | Codex | `HANDOFF-PORT-codex.md` |
| 1（并行） | DS Bot | `HANDOFF-PORT-dsh.md` |
| 1（并行） | WorkBuddy | `HANDOFF-PORT-workbuddy.md` |
| 1（并行） | Grok Bot | `HANDOFF-PORT-grok.md`（可能只能回答问题） |
| 2 | Cursor | `HANDOFF-MERGE.md` |
| 3 | 任一 | R4–R7：签名公证、打包发布、README、和现有 GitHub 仓库的关系 |

所有端口 agent 都先读 `HANDOFF-PORT-COMMON.md`。规则：只写自己的 `ports/<id>/`，不碰共享文件；必须交脱敏 fixtures 和 `check.mjs`。

开工前建议在代码目录 `git init` 并提交一次，方便合并时比对和回退。

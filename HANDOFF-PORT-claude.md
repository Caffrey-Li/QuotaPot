# 端口任务：Claude（Claude Code 命令行 + Claude 桌面版）

交给：Claude Code。先读 `HANDOFF-PORT-COMMON.md`。

端口 id：`claude`。一个端口，内部区分两个来源：
- `claude-code`：命令行，数据在 `~/.claude/`
- `claude-desktop`：桌面应用 `Claude.app`

发现时两个都检查。只装了一个，就只显示那个来源的数据。桌面版里的 Code 会话如果也写进 `~/.claude/projects/`，按 Claude Code 统计，不要重复计入。

| 槽 | 要做的 | 要核实的 |
|---|---|---|
| 发现 | `~/.claude/projects/` 存在 → claude-code；`/Applications/Claude.app` 存在 → claude-desktop | 两个路径都要实际确认 |
| 用量 | 会话 jsonl 里 assistant 消息的 `message.usage`：input、output、cache_creation、cache_read。单位 token。今日 / 7 天 / 30 天 | 同一条消息可能分多行写入，要按 `message.id` 去重。用本机数据确认去重前后的差别 |
| 模型 | 列出本地日志里出现过的 `message.model`，带用量。没有目录和状态接口，状态槽降级；速度写「无耗时」 | 日志里有没有可信的生成耗时字段；没有就降级 |
| 对话 | 一个 jsonl 一条会话。上下文 = 最后一条 assistant 的 input + cache 合计 / 模型窗口。压缩次数来自日志里的压缩记录 | 窗口大小从哪里来（不要写死）；压缩记录的真实字段名；没有采样就不写次数 |
| 动作·打开 | 在终端里 `cd <原项目> && claude --resume <id>` | 会激活终端，这和 Cursor 不抢焦点不同。在 README 里写明 |
| 动作·放入输入框 | 没有写入草稿的接口 → 降级为只复制。不要用 Cmd+V | — |
| 动作·开新 | 终端里 `cd <原项目> && claude "<提示词>"` | 提示词里的引号和换行要正确转义 |
| 提示词 | 指令文件 `CLAUDE.md`；整理交接里可以提到 `/compact` | 按 Claude Code 的约定核实 |
| 磁盘 | `~/.claude`：用户数据，标只读。`~/Library/Application Support/Claude/` 下的 Cache、GPUCache、DawnGraphiteCache：可清 | 逐个确认目录存在；会话、设置、技能都不能列为可清 |
| 菜单 | 降级：没有本地额度接口 | 如果发现可靠的本地额度来源，写进 CONTRACT-REQUESTS.md，不要直接用 |

**桌面版的普通聊天**本地没有 token 用量。用量、模型、对话三个槽在只装桌面版时全部降级，写明「Claude 桌面版的聊天用量不在本地」。

终端打开方式（Terminal、iTerm 等）先只支持系统自带的 Terminal，用 `osascript` 实现。实现写进模块，但验收时不要真的执行。

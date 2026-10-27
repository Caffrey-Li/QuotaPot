# 端口任务：Codex

交给：Codex。先读 `HANDOFF-PORT-COMMON.md`。

端口 id：`codex`。

旧核心里已经有 Codex 的读取代码，可以参考：`/Users/caffrey/.dsh/bot/workspace/dsh-bot-QuotaPot/agents/mcp/core.cjs` 和 `desktop.mjs` 里的 `codexUsage()`、`rateLimitsFromText()`。只参考，不要改那些文件。

| 槽 | 要做的 | 要核实的 |
|---|---|---|
| 发现 | `~/.codex/sessions/` 存在 | Codex 桌面应用和 IDE 扩展的会话是否也写在这里 |
| 用量 | rollout jsonl 里的 `token_count` 事件：input、cached_input、output、reasoning。单位 token。今日 / 7 天 / 30 天 | 没写 token_count 的会话不计入，界面上要说明。确认 token_count 是累计值还是增量，不要重复相加 |
| 模型 | 会话里记录的模型名，带用量。状态降级；速度写「无耗时」 | 有没有可信的耗时字段 |
| 对话 | 一个 rollout 一条会话。上下文 = 最近一次用量 / `model_context_window` | 窗口字段的真实位置；压缩事件的字段名；没有采样就不写次数 |
| 动作·打开 | 终端里 `codex resume <id>`，cwd 为原项目 | 原项目路径从会话元数据哪里读 |
| 动作·放入输入框 | 降级为只复制 | — |
| 动作·开新 | 终端里 `codex -C <原项目> "<提示词>"` | 用当前安装的 Codex 核实参数写法 |
| 提示词 | 指令文件 `AGENTS.md`；压缩命令 `/compact` | 按当前 Codex 文档核实 |
| 磁盘 | `~/.codex`：用户数据，标只读。日志或缓存目录如果确实可以重建，才列为可清 | 逐个说明为什么可清 |
| 菜单 | `rate_limits` 的 5 小时 / 7 天窗口已用百分比。单位 percent，标签写明是窗口百分比，不是 token | 取最近一次记录；记录太旧时要标明时间 |

终端打开方式先只支持系统自带的 Terminal。实现写进模块，但验收时不要真的执行。

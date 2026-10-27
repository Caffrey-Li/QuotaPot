# 端口任务：DeepSeek Harness（DSH / DS Bot）

交给：DS Bot。先读 `HANDOFF-PORT-COMMON.md`。

端口 id：`dsh`。

旧核心里已经有读取代码，可以参考：`/Users/caffrey/.dsh/bot/workspace/dsh-bot-QuotaPot/index.js` 的 `readUsage()`、`fetchBalance()`、`resolveApiKey()`。只参考，不要改那份文件。

| 槽 | 要做的 | 要核实的 |
|---|---|---|
| 发现 | `$DSH_HOME` 或 `~/.dsh` 存在 | 桌面版和 Web 版的数据目录是否相同 |
| 用量 | `~/.dsh/bot/usage.sqlite` 的 `calls` 表：input、cache_read、cache_write、output。单位 token。今日 / 7 天 / 30 天，可按 Bot 分组 | 表结构用本机数据库确认 |
| 模型 | 本地调用里出现过的模型，带用量。状态降级；`calls` 有时长列才算速度，否则「无耗时」 | 有没有时长列 |
| 对话 | 用 `calls.session` 算每条会话用量 | 窗口大小和压缩记录有没有来源；没有就降级比例和压缩 |
| 动作 | 打开对话、开新对话：查 DSH Web UI 有没有会话 URL，CLI 能不能带提示词开新。放入输入框：先降级为只复制 | 每个动作做不到就降级并说明原因 |
| 提示词 | 指令文件名按 DSH 的实际约定 | 查 DSH 文档或本机配置确认，不要默认写 AGENTS.md |
| 磁盘 | `~/.dsh`：用户数据，标只读 | 有没有可重建的缓存目录 |
| 菜单 | DeepSeek `/user/balance` 余额。单位 currency，写成「余额 ¥x」或「余额 $x」，不能当 token。没有 API Key 时降级 | API Key 的读取顺序照旧核心；不打印 key |

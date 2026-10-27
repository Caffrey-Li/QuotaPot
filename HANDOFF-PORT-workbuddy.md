# 端口任务：WorkBuddy

交给：WorkBuddy。先读 `HANDOFF-PORT-COMMON.md`。

端口 id：`workbuddy`。

旧核心里已经有读取代码，可以参考：`/Users/caffrey/.dsh/bot/workspace/dsh-bot-QuotaPot/index.js` 的 `readWorkBuddy()`。只参考，不要改那份文件。

| 槽 | 要做的 | 要核实的 |
|---|---|---|
| 发现 | `~/.workbuddy/workbuddy.db` 存在 | — |
| 用量 | `session_usage.credit_json`。单位 **credits**，今日 / 7 天 / 30 天。界面上必须写 credits，不能写 token | 确认 `updated_at` 的单位（毫秒还是秒），以及按会话的最后更新时间分天是否会把多天用量算到一天里；会的话在 README 写明误差 |
| 模型 | 如果 credit_json 的键是模型名，按模型分 credits。状态降级；「无耗时」 | 键到底是什么 |
| 对话 | 有会话行就列出会话和 credits。没有上下文 token，比例和压缩都降级 | 有没有其他表记录 token 或上下文 |
| 动作 | 查 WorkBuddy 有没有打开会话、带提示词开新的 URL scheme 或命令行。查不到就降级 | — |
| 提示词 | 指令文件名按 WorkBuddy 的实际约定 | 确认后再写 |
| 磁盘 | `~/.workbuddy`：用户数据，标只读。`~/Library/Application Support/WorkBuddy/` 下的 GPUCache、DawnGraphiteCache、Cache、Code Cache：可清 | 逐个确认目录存在 |
| 菜单 | 本地没有剩余额度就降级 | 有没有本地可读的套餐额度 |

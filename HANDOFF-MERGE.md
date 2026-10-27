# 合并任务

交给：完成阶段 0 的那个 agent（Cursor）。等各端口 agent 交付后再做。

1. 逐个读 `ports/<id>/README.md` 和 `CONTRACT-REQUESTS.md`。合同要改的话，先改合同和 `ports/cursor/`，再通知对应端口调整，不要一次性同时改多处。
2. 每个端口跑 `node ports/<id>/check.mjs`，全部通过再加注册表那一行。
3. 检查 fixtures 已脱敏：搜 `sk-`、`eyJ`、`@`、`/Users/caffrey`，有就退回。
4. `node desktop.mjs --check` 要对每个端口跑 fixture 自检，并保留 HANDOFF-MAIN 的全部验收项。
5. 在这台 Mac 上逐个切换端口，打开五个页面检查。不要点击「整理」「一键开新」「继承对话」和提示词代码块。
6. 检查单位：credits、余额、百分比没有出现在 token 的位置上；降级项显示中文原因，没有 0 占位。
7. Grok Bot 如果只交了问题回答，由你按回答写 `ports/grok/`。

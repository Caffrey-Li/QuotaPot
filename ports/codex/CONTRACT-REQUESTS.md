# 交给合并者的合同请求

本端口不改共享合同或界面。以下是已核实的显示限制，不能靠端口填入假数据解决。

1. **待用户执行的 Terminal 命令**：用户要求打开和开新只生成命令。现有成功结构表示已经打开/新建，界面也据此标记完成；没有展示待执行命令的动作类型。请求支持命令预览/复制及明确的未执行状态。当前 `actions.open/spawn = false`，动作返回 `{ ok:false, error, command, terminal }`；`terminal` 只是生成的系统 Terminal 执行描述，不启动进程。不要把生成成功改成 `spawned:true` 或打开成功。

2. **逐会话未知上下文**：目前 `ui/index.html` 的 `percentText(null)` 和 `statsLine()` 会把缺失数据显示成 `0%` 和 `0 token`。请求 `used/limit/percent` 为 `null` 时显示未知并隐藏比例和进度条。当前端口按真实数据返回 `null`，保留全部会话，不通过过滤来隐藏问题。

3. **明确压缩次数与未知丢失率分开**：`compacted` 事件可直接计数，但不能证明压缩平均丢失率。现有 `measured` 同时控制次数和丢失率显示，`renderPrompt()` 对缺失丢失率默认为 0。请求允许次数已知、丢失率未知。当前保留 `compactions` 的明确计数，`measured:false`、`lostRatio/growth:null`；生成提示词时省略无法证明的平均丢失率句子。

4. **只复制的动作状态**：提示词卡片依据 `ok` 显示“已粘贴”，不检查 `placed`。当前沿用 Cursor 的只复制降级格式 `{ok:false,copied:true,placed:false,error:'已复制，请手动粘贴到 Codex；不支持放入输入框。'}`，`actions.paste = false`，避免误称整理完成。请求界面根据 `copied/placed` 分别显示复制、放入和失败；允许复制成功而放入未完成。

合并者还需将菜单返回的窗口标签、时间和 `stale` 提示一起展示，不能只显示 `usedPercent` 后让用户误认实时额度。端口不修改菜单消费者。

# QuotaPot · Codex 端口

> 2026-10-26 精简：去掉了模型列表和 `diskTargets()`（磁盘目录统一在 `disk.mjs`）。能力为 `{ usage, chats, quota, actions: { paste: 'copy' } }`；5 小时 / 7 天窗口现在显示在用量页顶部的额度条里。下文的槽位表保留作开发记录。

端口 id：`codex`。只新增本目录；没有修改注册表、Cursor、共享界面或主程序，也没有提交 commit。

## 数据源与边界

- 只读扫描 macOS 的 `~/.codex/sessions/**/*.jsonl`。不读取 `auth.json`、配置、钥匙串、SQLite 或其他端口的数据，不发网络请求。
- 导入模块不扫描文件、不起服务、不发请求。`discover()` 只判断平台和会话目录是否存在。正式读取逐行扫描，并按文件大小与修改时间缓存解析结果；上次用量和上下文快照仅保存在进程内。
- 使用 `session_meta.payload.id`（兼容 `session_id`）、`cwd`、`timestamp`、`model_provider`；模型来自 `turn_context.payload.model`。未读取真实对话正文作为标题，标题使用 `Codex <编号前八位>`。
- 本机已观察到 `originator: Codex Desktop` 和 `codex_work_desktop` 的会话都在该目录，`source` 可为 `vscode` 或 subagent。仅凭 `source:vscode` 不能证明来自 IDE 扩展；独立的 IDE 扩展来源尚未验证。
- `token_count` 位于 `event_msg.payload`；窗口在 `payload.info.model_context_window`。最近上下文用量取 `info.last_token_usage.total_tokens`，不能使用跨请求累计量。
- 压缩是顶层 `type:compacted` 记录。只计明确事件；没有明确事件时次数为 `null`。不根据用量下降猜压缩、不猜丢失率。
- 日志有 `task_complete.duration_ms` 和 `turn_aborted.duration_ms`，它们包含整个任务的时间，不能作为每次模型生成耗时。

## 八个槽

| 槽 | 结果 | 说明 |
| --- | --- | --- |
| 发现 | 做到 | macOS 上判断 `~/.codex/sessions` 存在；没有安装或目录缺失时中文降级 |
| 用量 | 做到，覆盖不足会标明 | 今日/7天/30天，单位 `token`；无可核实 `token_count` 的会话不计入；全部缺失时降级且不返回 0 |
| 模型 | 用量做到，状态/速度降级 | 已记录模型及本地 token 用量；状态“未核实”，`speed:null`，显示“无耗时” |
| 对话 | 做到，未知字段降级 | 一个 rollout 一条；80% 只高亮不过滤；没有窗口或用量时比例为 `null`；压缩丢失率和增幅未测量 |
| 动作 | 降级 | 打开/开新只生成系统 Terminal 命令，未执行；放入输入框只复制，不自动粘贴 |
| 提示词四条 | 做到 | 调用共享 `renderPrompt`；产品 Codex、`AGENTS.md`、`/compact`；没有上下文数字就删掉那一行 |
| 磁盘 | 做到，只读 | 仅 `~/.codex`，`safe:false`；含会话、配置、凭据及用户资产，没有证据证明哪些目录可安全重建，因此不列清理项 |
| 菜单 | 做到，过时记录会标明 | `rate_limits` 的 5小时/7天窗口已用百分比，`unit:percent`，不是 token；带标签、记录时间、年龄和过时状态 |

现有共享界面对未知上下文和复制状态的显示存在限制，详见 [CONTRACT-REQUESTS.md](./CONTRACT-REQUESTS.md)。本端口不改合同，不用假数据绕过限制。

## 用量计算

1. 按 rollout 文件原始顺序读取全部计数，先建立范围开始前的基线，再按事件时间归入今日/7天/30天。本地日历日从本机午夜开始，7天/30天包含今日。
2. `total_token_usage` 是累计值；相邻不变不重复计入。累计回退视为新计数段。首次或重置后的累计量大于最近单次时，只计 `last_token_usage`，无法确定发生时间的历史基数不计入，并标 `truncated:true`。因此数据可能是部分观测，不是账单。
3. `tokens` 是可核实增量的 `total_tokens` 合计。原始 `input_tokens` 已包含 `cached_input_tokens`，原始 `output_tokens` 已包含 `reasoning_output_tokens`。返回模型行中的 `input` 是非缓存输入，`cacheRead` 是缓存输入，`output` 包含推理，另附 `reasoning` 供查看；不把缓存和推理重复相加。
4. `calls` 是正用量增量记录数，不保证等于用户发言数或服务端计费请求数。`models()` 的用量范围是所有保留的、可核实的本地记录。
5. 缺失或损坏的数据不写成 0。无用量会话通过 `excludedSessions` 计数；中文说明放在界面已支持的 `truncatedNote` 中。读不到文件、损坏记录和历史基数不完整也会标明部分覆盖。已观测但所选日期没有增量时，返回真实的 0。

## 菜单计算

取所有可读 rollout 中时间最新的 Codex 额度记录，保留 `primary/secondary` 原始窗口信息。按 `window_minutes` 的 300 / 10080 映射 5小时 / 7天，不假设 primary 永远是5小时，也不把 reserve 池当 Codex 通用额度。

`used_percent` 缺失、非法或窗口不匹配时降级，不默认 0。顶层 `usedPercent` 优先5小时，没有时用7天并明确标签。每次都返回记录时间；超过15分钟或所选窗口已到重置时间，标 `stale:true`，不推测重置后的当前占用。15分钟是本端口的保守过时提示阈值，不是服务端刷新周期。

## 动作只生成，不执行

- `terminalCommand('open', {chatId, workspace})` 生成 `cd -- '<原项目>' && codex resume '<UUID>'`。
- `terminalCommand('spawn', {text, workspace})` 生成 `codex -C '<原项目>' -- '<提示词>'`。`--` 保证以短横线开头的提示词也是正文。
- 同时生成系统 Terminal 的 AppleScript 执行描述，保存在 `terminal` 返回值中；模块不调用该描述。路径、提示词经过 shell 单引号转义，编号严格校验为 UUID，AppleScript 字符串单独转义。
- `open()` 从原会话元数据读取完整 `cwd`，`spawn()` 要求传入原项目绝对路径。因为没有真正打开或新建，两者返回 `ok:false`、中文 `error` 和生成的命令，不声称 `spawned:true`。`phase:done` 没有待恢复动作，返回中文错误。
- `paste()` 只在用户实际调用时使用 `/usr/bin/pbcopy`，不读写 Codex 输入框、不按键、不执行提示词。复制成功后返回 `copied:true,placed:false` 的中文降级；自检不调用真实复制。
- `capabilities.actions` 三项均为 `false`，不让现有界面误把命令生成或复制当作动作完成。待执行命令的显示请求交给合并者处理。

本机 `codex-cli 0.164.0-alpha.11.1` 的 `--help` / `resume --help` 已核实 UUID 恢复、`-C/--cd` 和位置提示词参数。仅运行帮助，没有启动会话。提示词约定已通过官方文档核实：[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[/compact](https://learn.chatgpt.com/docs/developer-commands?surface=cli)。

## Fixtures 与自检

六份 JSONL 均来自本机真实 rollout 的小片段：

| 文件 | 覆盖 |
| --- | --- |
| `rollout-cumulative.jsonl` | 旧版桌面元数据、模型、累计/单次用量、上下文窗口、reserve窗口 |
| `rollout-modern.jsonl` | 当前桌面元数据、Codex 5小时/7天窗口 |
| `rollout-duplicate.jsonl` | 重复累计快照、带历史基数的首条记录 |
| `rollout-reset.jsonl` | 累计值回退重置 |
| `rollout-unmetered.jsonl` | 没有 token_count 的会话 |
| `rollout-compacted.jsonl` | 明确的压缩事件、继承累计基数、超过80%的上下文 |

采用字段白名单脱敏：移除真实正文、摘要、指令、替代历史、账户信息、凭据与邮件；会话编号改成固定示例 UUID，项目路径改为 `/Users/example/projects/demo`。保留真实数值与字段结构。片段不代表完整会话用量，不将几份来自同一源的片段合起来当账单。

```sh
node ports/codex/check.mjs
```

自检只使用 fixtures 和由 fixtures 派生的边界案例，不要求安装 Codex。覆盖累计去重、重置、历史基数、跨日范围、模型归属、单位、未知值、四条提示词、80%边界、过时窗口、命令转义、导入无读取副作用及缺少产品时降级。不执行 Terminal、Codex 会话命令或真实剪贴板动作。

## 注册表交接

由合并者在 `ports/registry.mjs` 添加：

```js
import * as codex from './codex/index.mjs'
```

然后在现有 `ports` 数组中追加 `codex`，保留其他所有端口。本次没有改注册表。

## 本机验收

2026-10-25（America/Edmonton）完成：

- 开工基线：`ports/cursor/` 存在，`node desktop.mjs --check` 通过。
- 在真实代码目录运行 `node ports/codex/check.mjs` 通过，输出 `codex port check ok (fixtures only; no Terminal or clipboard actions executed)`；还在全新临时 HOME 中只放 fixtures，验证公开入口及未安装产品的降级。`models()` / `headers()` 按主程序调用方式同步返回对象。
- 10:50:14 本机只读验收快照：发现24条会话，19条有可核实用量，5条未计入；今日/7天/30天均返回 `unit:token`；6个模型均为“未核实”、`speed:null`；24条对话和标题均返回，5条上下文未知保持 `null`，没有按80%过滤。活动会话还会继续写日志，因此数量随时间变化。
- 菜单读取到5小时/7天百分比，单位 `percent`，带时间及过时状态；磁盘目标全部只读。最终读取器首次扫描约2.2秒，后续按修改时间复用缓存；同步入口首次读取会短暂占用主进程。
- 打开和开新只验证生成结果；没有执行 Terminal、恢复/新建会话或真实剪贴板动作。没有独立验证 IDE 扩展来源或模型实时状态。
- 注册表未添加，尚未做注册后的端到端界面验收；已发现的共享界面限制和所需改动列于 `CONTRACT-REQUESTS.md`。
- 本任务仅新增本目录10个文件。工作期间共享界面及 Cursor 发生了其他并发改动，均保留，没有回退或修改。

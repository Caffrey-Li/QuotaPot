# Claude 端口

> 2026-10-26 精简：只保留 Claude Code 来源（桌面版本地没有用量，已去掉）；去掉了模型列表、`menu()` 和 `diskTargets()`（磁盘目录统一在 `disk.mjs`）。能力为 `{ usage, chats, actions: { paste: 'copy' } }`，整理流程是「复制整理 → 复制继承」。`CONTRACT-REQUESTS.md` 里第 2、4、5、6、7、8 条已在这次处理。下文的槽位表保留作开发记录。

端口 id：`claude`。一个端口，两个来源：

- `claude-code`：Claude Code 命令行（也包括桌面版里的 Code 会话），数据在 `~/.claude/projects/`。设置了 `CLAUDE_CONFIG_DIR` 时用那个目录。
- `claude-desktop`：`/Applications/Claude.app` 或 `~/Applications/Claude.app`。

## 注册表要加的一行

```js
import * as claude from './claude/index.mjs'
export const ports = [cursor, claude]
```

## 读取了什么

| 来源 | 读法 | 用途 |
| --- | --- | --- |
| `~/.claude/projects/<项目>/<会话id>.jsonl` | 只读，逐行解析 | 用量、模型、对话列表、上下文、压缩 |
| `~/.claude/projects/<项目>/<会话id>/subagents/*.jsonl` | 只读 | 计入用量，不计入对话上下文 |
| `Claude.app` 是否存在 | `stat` | 发现 |
| `~/Library/Application Support/Claude/` | 只在空间页扫大小 | 磁盘 |

不读任何凭据、钥匙串或 API key，不发网络请求。快照写在共享 `snapshot.json` 的 `claude` 键下，不碰 Cursor 的 `usage`、`context`、`trends`。

## 八个槽

| 槽 | 结果 | 说明 |
| --- | --- | --- |
| 发现 | 做到 | 两个来源分别判断，`discover().sources` 列出装了哪个 |
| 用量 | 做到（仅 Claude Code） | 单位 token。assistant 消息的 `message.usage`：input、output、cache_creation、cache_read。同一个 `message.id` 在多行出现时只算一次，取 output 最大的那行；续接会话重放的旧消息跨文件去重。`<synthetic>` 不计。子代理计入。不截断。只装桌面版时降级：「Claude 桌面版的聊天用量不在本地」 |
| 模型 | 部分做到 | 只能列出本地日志里用过的模型和 token。没有目录和服务状态，状态写「无状态」；没有生成耗时，速度为 `null`（界面显示「无耗时」）。消息时间戳差值不是生成耗时，没有用 |
| 对话 | 做到（仅 Claude Code） | 最近 60 个会话。上下文 = 最后一条主链 assistant 的 input + cache_creation + cache_read。窗口：默认 200K；模型名带 1m，或任何一次采样超过 200K，按 1M 算（推断，见下）。80% 以上才整份读取：压缩次数用 `system/compact_boundary` 记录，丢失比例 = (`compactMetadata.preTokens` − 压缩后第一次采样) / `preTokens`；没有记录时退回采样下跌。未采样的条目 `measured:false` |
| 动作·打开 | 已实现，能力标 false | Terminal 里 `cd <项目> && claude --resume <id>`。会激活终端 |
| 动作·放入输入框 | 降级 | 没有从外部写入 Claude 输入框的接口。`paste()` 只复制到剪贴板，返回 `placed:false`，不用 Cmd+V |
| 动作·开新 | 已实现，能力标 false | Terminal 里 `cd <项目> && claude $'<提示词>'`。提示词用 ANSI-C 引号放在一行里；命令作为 osascript 参数传入，不拼进 AppleScript 源码 |
| 提示词 | 做到 | 产品名 Claude Code，指令文件 `CLAUDE.md`，压缩命令 `/compact`。只装桌面版时产品名改为 Claude，删掉上下文行和压缩命令 |
| 磁盘 | 做到 | `~/.claude` 和 `Application Support/Claude` 标只读（用户数据）。Cache、Code Cache、GPUCache、DawnGraphiteCache 和 `~/Library/Caches/com.anthropic.claudefordesktop` 可清。不存在的目录由空间页跳过 |
| 菜单 | 降级 | Claude 没有本地额度接口 |

三个动作能力都标 false 的原因见 `CONTRACT-REQUESTS.md` 第 1、2 条：现在的界面点对话行会让原生窗口去激活 Cursor 并按快捷键；「一键开新」要求先 `placed:true`，Claude 永远做不到。合并的人改完界面后，把 `capabilities.actions.open`、`spawn` 改成 true 即可，函数已经写好。

## 推断和未核实的地方

1. **1M 窗口**：日志不记录窗口大小。1M 会话在用到 200K 之前会被当成 200K，160K 时就会提前高亮。
2. **会话标题**：用 `summary` 行或 `custom-title` 行，没有就用第一条真实提问（跳过斜杠命令和系统提醒）。新版本如果换了标题行的类型名，会退回第一条提问。
3. **桌面版缓存目录名和 bundle id**（`com.anthropic.claudefordesktop`）按已知命名写，未在这台机器核实。写错只会让空间页找不到该项，不会误删。

## 验收

- `node ports/claude/check.mjs`：通过。只读 `fixtures/`，覆盖发现（两个来源、只有桌面版、都没装）、去重、截止时间、子代理、`<synthetic>`、坏行、标题、上下文、窗口推断、压缩、四条提示词、命令生成与转义、能力、磁盘标记、菜单降级，以及 fixtures 不含密钥和用户路径。
- 用临时 HOME 把 fixtures 当成真实安装，`usage`、`models`、`chats`、`headers`、`prompts`、`menu` 端到端跑通，快照只新增 `claude` 键。
- **真机数据还没核实。** 开发这个端口的会话无法读取 `~/.claude`（受保护目录）。请在 Mac 终端运行：

  ```sh
  cd quotapot && node ports/claude/probe.mjs
  ```

  它只输出字段名、数量和合计，不输出对话内容、标题、路径或密钥。重点看：`usageKeys` 是否是那四个字段；`systemSubtypes` 里有没有 `compact_boundary`、`compactMetadataKeys` 里有没有 `preTokens`；`otherLineTypesAndKeys` 里标题行叫什么；`durationLikeFields` 是否有可信的生成耗时；`usage1/7/30` 是否和你在 Claude Code 里看到的量级一致。
- 打开、开新只验证了生成的命令，没有真的执行。

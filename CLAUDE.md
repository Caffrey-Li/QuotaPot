# CLAUDE.md

给之后在这个仓库里工作的 Claude 看。安装和使用以 `README.md` 为准，这里只补开发需要的部分。

## 项目是做什么的

QuotaPot 是 AI 编程对话的上下文和额度管家：常驻在编辑器旁边，对话快满了提醒整理交接，额度和用量一眼看清，顺手清理本机 AI 工具的缓存。支持 Mac 和 Windows，界面文案都是中文。

定位（2026-10-26 重新梳理）：核心是对话健康，其次是额度和用量，空间是附带的本机工具。**每个端口只显示真正读得到、用户真正能用的内容；读不到的不声明、不显示，不放灰色的降级说明。**

- `desktop.mjs` 在 `127.0.0.1:18765` 起一个本地服务，端口可以用环境变量 `QUOTAPOT_PORT` 改。界面就是这个服务返回的 `ui/index.html`。
- Mac 上由 `native/Window.swift` 编译出的 `/Applications/QuotaPot.app` 承载窗口，另有菜单栏鲸鱼和 Dock 角标。Windows 上用 Edge 或 Chrome 的 `--app` 模式打开窗口。
- 窗口有三个页：**对话 · 用量 · 空间**。原来的「模型」页并进了用量页（只提醒降级和停用的模型），「工具」页并进了对话页底部的「提示词」折叠区。
- 对话和用量按端口显示，页签按端口能力显示或隐藏（DS Bot 没有对话页）。空间页扫描整台电脑，不受端口切换影响，端口切换条只在对话和用量页出现。
- 每个 AI 工具是一个「端口」，放在 `ports/<id>/`，由 `ports/registry.mjs` 注册。目前注册了 cursor、claude（Claude Code）、codex、dsh（DS Bot / DeepSeek Harness）、workbuddy。界面只显示本机装了的端口。Grok Bot（本地读不到任何数据）和 Claude 桌面版（本地没有用量）已经去掉，它们的缓存目录仍在空间页。
- 版本号在 `desktop.mjs` 的 `VERSION` 里。发布和自动更新走 GitHub Releases（`Caffrey-Li/QuotaPot`）。

## 目录

| 路径 | 作用 |
| --- | --- |
| `desktop.mjs` | 本地服务、API 路由、安装、自动更新、`--check` 自检。主入口受 `isMain` 判断保护。 |
| `disk.mjs` | 空间页唯一的磁盘目标清单（Mac / Windows 路径，`group` 按工具分组，`safe` 标记哪些可清）。端口里不再放磁盘目录。 |
| `ui/index.html` | 全部界面。`serve()` 启动时只读一次。 |
| `native/` | macOS 窗口 `Window.swift`、图标和生成图标的脚本。 |
| `ports/registry.mjs` | 端口注册表：`ports` 数组、`getPort`、`installedPorts`。 |
| `ports/README.md` | **端口合同**：必须导出的名字、返回结构、降级、单位、提示词、自检。改端口前先读这份。 |
| `ports/cursor/` | 参考实现。其他端口照它的导出名和返回结构写。 |
| `ports/<id>/` | 每个端口的 `index.mjs`、`check.mjs`、`fixtures/`（脱敏样本）、`README.md`，有的还有 `CONTRACT-REQUESTS.md`。 |
| `ports/prompts.mjs` | 四条提示词（新会话、整理交接、继承、崩溃后开新）的统一模板 `renderPrompt`。 |
| `ports/degrade.mjs`、`sqlite.mjs`、`snapshot.mjs`、`context.mjs` | 端口共用的降级、只读 SQLite、快照、上下文计算。 |
| `HANDOFF-*.md` | 之前分给各个 agent 的任务单：阶段 0（MAIN）、端口公共规则（PORT-COMMON）、各端口、合并（MERGE）、总体规划（PORTS-PLAN）。规则和验收项仍然有效；里面写的分工范围是当时那一阶段的。 |
| `.cursor-plugin/`、`skills/` | 早期 Cursor 插件形态的遗留。`plugin.json` 版本停在 0.3.0，`skills/quotapot/` 是空的。 |

## 安装和运行

需要 Node.js 22.5 或更新（要用 `node:sqlite`）。没有 `package.json`，也没有第三方依赖，不需要 `npm install`。

用户安装方式见 `README.md`：

```sh
node desktop.mjs --install
```

开发时常用：

```sh
node desktop.mjs            # 只起本地服务（Windows 上会顺便打开窗口）
node desktop.mjs --check    # 自检；会逐个运行已注册端口的 ports/<id>/check.mjs
node ports/<id>/check.mjs   # 单独跑一个端口的 fixture 自检
```

- 只改了 `ui/index.html` 或 `desktop.mjs`：**不要** `--install`。分别结束 QuotaPot 应用和 `desktop.mjs` 进程，再 `open /Applications/QuotaPot.app`。zsh 里不要用 `kill $(pgrep …)`。
- 改了 `native/Window.swift` 才需要 `--install` 重新编译。`--build` 只编译不打开，主要给自动更新用。
- 自动更新会先在新版本上跑 `--check`，要求输出里有 `quotapot self-check ok`。所以 `--check` 必须保持能在用户机器上通过。

## 代码约定

- 全部是 ESM `.mjs`，只用 Node 内置模块。风格跟现有代码一致：两格缩进、单引号、不写分号。
- 用户能看到的文字都用中文。降级原因也用中文。
- **端口合同**（细节见 `ports/README.md`）：
  - 按能力声明：`capabilities = { usage, chats, quota, modelStatus, actions: { open, paste: 'place'|'copy'|false, spawn } }`。只声明并导出做得到的部分，`--check` 会核对声明和导出是否一致。`usage` 和 `chats` 都做不到的端口不要注册。
  - 运行时失败（没登录、没 API Key、读不到文件）仍返回 `degrade('中文原因')`。不要返回 0，不要借别的端口的数据。
  - `usage()` 和 `menu()` 必须带真实的 `unit`：`token`、`credits`、`percent` 或 `currency`。
  - 没有上下文采样时 `measured: false`，不写「压缩 0 次」。没有可信的生成耗时就不要显示速度（「无耗时」已经从界面去掉）。
  - `import` 端口模块时不能有副作用：不起服务、不发请求、不读文件。`discover()` 只判断是否存在。
  - 提示词只通过 `promptProfile` 加 `renderPrompt` 生成。四条的骨架不变：复述目标、已完成、未完成、不能再改的地方，不确定的标出来，然后停下来。
  - SQLite 只用 `ports/sqlite.mjs` 的 `openRead`（只读）或 `openWrite`（用完关闭），不调用 `sqlite3` 命令行。
  - 新端口只新增 `ports/<id>/` 并在注册表加一行。fixtures 要脱敏，`check.mjs` 只读 fixtures，没装这个产品的机器也要能通过。
- 合同要改时，先改合同和 `ports/cursor/`，再改其他端口，不要一次同时改多处。

## 必须保持的行为

`HANDOFF-MAIN.md` 的「必须保持」一节里，关于五个页、「无耗时」和自检文字的条目已被 2026-10-26 的精简取代，以这里为准：

- 只有三个页：对话、用量、空间。没有单独的余额、模型、工具页，没有 MCP，没有 `data-tab="agents"`。
- 对话阈值是 80%，只高亮，不过滤。文案是「上下文消耗增幅」。
- 整理流程分两档：`paste:'place'`（Cursor）是 整理 / 一键开新 → 继承对话 → 不显示按钮，只有 `placed: true` 才算整理成功；`paste:'copy'`（Claude Code、Codex、WorkBuddy）是 复制整理 → 复制继承 → 不显示按钮，没有「一键整理」和「一键开新」。
- 整理时把提示词写进 composer 草稿，不用 Cmd+V，不抢 Cursor 焦点。一键开新和继承都不激活 Cursor。
- 空间阈值默认 3 GB，只高亮，不阻止勾选。要两步确认才清理。清理只认 `disk.mjs` 里的 id。选中一个目录时，它里面的缓存显示为「已包含」，清理时只删外层。
- 窗口尺寸：收起 400×680，展开 860×680，最小 360×480。标题栏和菜单栏不出现「QuotaPot」文字，窗口里没有鲸鱼和波浪。页面顶部内边距是 `12px 16px 16px`。
- `--check` 里检查的界面文字（用量、对话、空间、额度、阈值、上下文消耗增幅、整理、一键整理、继承对话、一键开新、复制整理、复制继承、耗时、崩溃、提示词、80%）不能删；`data-tab="models"`、`data-tab="tools"`、「无耗时」不能再出现。

## 不要做的事

- 不要打印或写入 token、API key、JWT、钥匙串密码、邮箱。日志和 fixtures 里也不行。
- 不要把 credits、余额或百分比放到 token 的位置上。
- 用户数据一律只读。不要改其他产品自己的配置文件。
- 不要安装系统根证书，不要 force-push，不要跑 `cursor agent`。
- 验证时不要真的点「整理」「一键整理」「一键开新」「继承对话」或提示词代码块，只检查生成的命令或链接。
- 只改 HTML 或 `desktop.mjs` 时不要 `--install`。
- `import desktop.mjs` 时不能调用 `serve()`，`desktop.mjs` 不能从项目外的绝对路径 import（自检会查）。
- 不要改旧版核心 `~/.dsh/bot/workspace/dsh-bot-QuotaPot/index.js`。
- 没有明确要求时，不要改窗口外观、卡片布局、阈值或清理规则。
- 用户没要求时不要 commit。仓库里经常有未提交的改动，不要 reset 或 checkout 掉。

## 补充：现状（2026-10-26 核对）

- **代码位置**：现在在 `~/Projects/QuotaPot`。最早的目录 `~/.cursor/plugins/local/quotapot` 已经清空，不要去那里找代码。`HANDOFF-PORT-claude.md` 等较早的任务单里如果还写着旧路径，以这里为准。
- **git**：只有两个提交（`baseline before ports`、`Extract a port contract and move Cursor behind it.`），之后的合并和各端口都还没提交。本地没有配置 remote。发布用的仓库是 `Caffrey-Li/QuotaPot`（见 `desktop.mjs` 的 `RELEASES`），和更早的 `Caffrey-Li/dsh-bot-QuotaPot`（DSH 插件、VSIX、MCP 三种形态）不是同一个产品形态，不要混用。
- **版本号**：`desktop.mjs` 里 `VERSION` 是 `0.5.1`；`.cursor-plugin/plugin.json` 停在 `0.3.0`，不代表当前版本。
- **各端口的指令文件**（来自各自的 `promptProfile`）：

  | 端口 | 指令文件 | 压缩命令 |
  | --- | --- | --- |
  | cursor | AGENTS.md | 无 |
  | claude | CLAUDE.md | /compact |
  | codex | AGENTS.md | /compact |
  | dsh | AGENTS.md | 无 |
  | workbuddy | CODEBUDDY.md | /compact |

- **README 的截图**：`README.md` 引用了 `docs/*.png`，但仓库里还没有 `docs/` 目录。
- **自检现状**：2026-10-26 精简后，在 Linux 环境（从云端会话连到这台 Mac 的 shell）里 `node desktop.mjs --check` 通过。之前 codex 那一步失败，是因为它的检查把 `fs.readFileSync` 整个替换掉，而 Node 加载 ESM 模块本身要用它；现在只放行 `.mjs/.js/.json`。Mac 上是否通过没有核实；发版前必须在 Mac 上跑一次，因为自动更新要求输出 `quotapot self-check ok`。
- **菜单栏**：`/api/status` 和 `native/Window.swift` 仍只显示 Cursor 和 Codex，没有改成读各端口的 `menu()`；改 Swift 需要在 Mac 上 `--install` 重新编译。
- **从云端会话开发时**：`~/.claude`、`/Applications/*.app` 属于受保护位置，读不到。Claude 端口要用真实数据核实，请用户在 Mac 终端运行 `node ports/claude/probe.mjs`（只输出字段名和统计），见 `ports/claude/README.md`。

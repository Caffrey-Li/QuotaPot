# 合同请求（workbuddy 端口）

没有自己改合同，下面四条只提交给合并的人判断。

## 1. snapshot.json 要按端口 id 分命名空间

`ports/snapshot.mjs` 是一份共享文件，Cursor 端口把 `usage[days]`、`context`、`composers`、`trends` 写在根上。多端口同时存在时后写的会覆盖前一个，`peekUsage` / `peekContext` 会串味。

本端口先自己规避了：写在 `snapshot().workbuddy.usage[days]` 和 `snapshot().workbuddy.context`。dsh 端口也用了 `snapshot().dsh`。建议合同明确「快照按端口 id 命名空间」，并把 Cursor 那几个键也挪进 `cursor`，需要时一并改。

## 2. `models[]` 的数值字段叫 `tokens`，但单位由 `unit` 决定

合同里 `usage()` 返回 `{ unit, tokens, calls, models }`，`models[]` 里也用 `tokens`。当 `unit: 'credits'` 时这个字段装的是 credits，名字会误导（读代码的人容易以为是 token）。界面已经按 `unit` 格式化，功能没问题。建议要么加一个与单位无关的字段名 `amount`，要么在合同里写死一句「`tokens` 是数值槽，含义由 `unit` 决定」。

## 3. 界面两处文案在非 token 单位下不成立

- `renderUsage`：`usage-note` 写「按模型看 X 的 token 消耗，含输入、输出和缓存合计」，`unit` 是 credits 时「token」是错的。
- `trendLine(chat)`：`measured === false` 时写「未超过 X%，未采样压缩」。本端口所有会话都是 `measured: false`（本地没有时间序列），但高亮行（≥80%）也会显示这句「未超过 X%」，和行本身的高亮自相矛盾。建议拆成 `measured` 为假时只写「未采样压缩」，不带阈值判断。

这两处在 `ui/index.html`，我没有改。

## 4. 想要一个「只复制」的动作类型

现在 `capabilities.actions.paste` 为 false 会连「整理」按钮一起隐藏，端口连「把提示词复制到剪贴板」这条路都没有。WorkBuddy（以及其它没有写入输入框接口的端口）能做到的上限就是复制。建议合同加一个 `actions.copy`，为 true 时界面显示「复制」按钮并调用端口的 `paste({ text })`，按 `copied` 提示；`paste` 仍为 false 时不承诺「已放入」。

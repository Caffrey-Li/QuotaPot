/* QuotaPot: a floating DeepSeek balance and usage pill for DSH / DS Bot.
   Loaded from /quotapot/widget.js. No framework, no build step. */
(() => {
  if (window.__QUOTAPOT_WIDGET__) return
  window.__QUOTAPOT_WIDGET__ = true

  const bridge = window.__QUOTAPOT__
  const HOST_ID = 'quotapot-host'
  const STORAGE_KEY = 'quotapot-position'
  const config = bridge?.config ?? {}
  const token = bridge?.token ?? ''
  const refreshSeconds = Math.min(600, Math.max(10, Number(config.refreshSeconds) || 30))
  const threshold = Math.max(0, Number(config.lowBalanceThreshold) || 0)
  const position = ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(config.position)
    ? config.position
    : 'bottom-right'

  const htmlLang = String(document.documentElement?.lang || '').toLowerCase()
  const navLangs = [...(navigator.languages || []), navigator.language]
    .filter(Boolean).map(value => String(value).toLowerCase())
  const timeZone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '')
  const chineseZone = [
    'Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi',
    'Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei',
  ].includes(timeZone)
  const autoZh = chineseZone || navLangs.some(lang => lang.startsWith('zh')) || htmlLang.startsWith('zh')
  const locale = config.locale === 'zh' || (config.locale === 'auto' && autoZh) ? 'zh' : 'en'
  const zh = locale === 'zh'

  const text = {
    title: 'QUOTAPOT',
    balanceTab: zh ? '余额' : 'Balance',
    usageTab: zh ? '用量' : 'Usage',
    loading: zh ? '余额 …' : 'Balance …',
    unavailable: zh ? '余额 --' : 'Balance --',
    topUpBalance: zh ? '充值余额' : 'Top-up balance',
    grantedBalance: zh ? '赠金余额' : 'Granted balance',
    updated: zh ? '更新于' : 'Updated',
    refresh: zh ? '刷新' : 'Refresh',
    low: zh ? '余额偏低' : 'Low balance',
    insufficient: zh ? '余额不足，请及时充值' : 'Balance is low — top up soon',
    noKey: zh ? '未找到 DEEPSEEK_API_KEY，请在 设置 → 模型 中配置' : 'No DEEPSEEK_API_KEY. Add one in Settings → Models.',
    auth: zh ? 'API Key 无效或已过期' : 'API key rejected or expired',
    rate: zh ? '请求过于频繁，稍后再试' : 'Rate limited. Try again shortly.',
    network: zh ? '网络错误，检查连接后重试' : 'Network error. Check your connection.',
    reload: zh ? '请刷新页面后重试' : 'Reload the page and try again.',
    notReady: zh ? 'QuotaPot 未初始化，请刷新页面' : 'QuotaPot is not ready. Reload the page.',
    today: zh ? '今日' : 'Today',
    sevenDays: zh ? '7 天' : '7 days',
    thirtyDays: zh ? '30 天' : '30 days',
    tokens: 'tokens',
    todayTokens: zh ? '今日 tokens' : 'Tokens today',
    spanTotal: zh ? '跨度合计' : 'Total span',
    calls: zh ? '次调用' : 'calls',
    dailyLimit: zh ? '今日上限' : 'Daily limit',
    overLimit: zh ? '今日 token 已超阈值' : 'Daily token limit exceeded',
    noLimit: zh ? '未设置每日上限' : 'No daily limit set',
    noUsage: zh ? '暂无用量数据（DS Bot 尚未记录）' : 'No usage data yet.',
    usageUnavailable: zh ? '用量数据不可用' : 'Usage data unavailable.',
    usageHint: zh ? '数据来自 DS Bot usage.sqlite，按本地日期统计。' : 'From DS Bot usage.sqlite, grouped by local day.',
    bot: 'Bot',
    group: zh ? '群聊' : 'Group',
    agent: 'Agent',
    other: zh ? '其他' : 'Other',
    viewUsage: zh ? '查看用量' : 'View usage',
    petTitle: zh ? '小鲸鱼：点我冲浪' : 'Whale: click to surf',
    spaceTab: zh ? '空间' : 'Space',
    updateFound: zh ? '发现新版本' : 'New version',
    update: zh ? '更新' : 'Update',
    updateConfirm: zh ? '确认更新' : 'Confirm update',
    updating: zh ? '更新中…' : 'Updating…',
    updateDone: zh ? '已安装，重启 DSH 生效' : 'Installed. Restart DSH.',
    updateFailed: zh ? '更新失败' : 'Update failed',
    scan: zh ? '扫描 AI 工具' : 'Scan AI tools',
    scanning: zh ? '扫描中…' : 'Scanning…',
    free: zh ? '可用' : 'Free',
    aiTotal: zh ? 'AI 工具合计' : 'AI tools total',
    safeTag: zh ? '可清理' : 'Safe',
    readOnly: zh ? '只读' : 'Read-only',
    cleanSelected: zh ? '清理选中' : 'Clean selected',
    confirmClean: zh ? '确认清理' : 'Confirm clean',
    cleaning: zh ? '清理中…' : 'Cleaning…',
    freed: zh ? '已释放' : 'Freed',
    cleanFailed: zh ? '清理失败' : 'Cleanup failed',
    scanFailed: zh ? '扫描失败' : 'Scan failed',
    noDisk: zh ? '未发现 AI 工具目录' : 'No AI tool folders found',
    diskHint: zh ? '阈值只用于高亮，不限制清理；有勾选框的是安全缓存，没有勾选框的是用户数据，删除会丢会话/设置/快照。' : 'The threshold only highlights; it never gates cleanup. Checkboxes are safe caches; uncheckable rows are user data (chats, settings, snapshots).',
    diskThreshold: zh ? '阈值' : 'Threshold',
    over: zh ? '超过' : 'over',
  }

  if (!bridge || !token) {
    console.warn('[quotapot]', text.notReady)
    return
  }

  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;z-index:2147483000;pointer-events:none;'
  const inset = position.startsWith('top') ? 'top:18px;' : 'bottom:92px;'
  const side = position.endsWith('left') ? 'left:18px;' : 'right:18px;'
  host.style.cssText += inset + side
  ;(document.documentElement || document.body).appendChild(host)

  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { position: relative; pointer-events: none;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      .pill { pointer-events: auto; display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 11px; border-radius: 999px; border: 1px solid rgba(120,120,128,.22);
        background: rgba(255,255,255,.84); color: #1c1c1e;
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 4px 16px rgba(0,0,0,.10); cursor: pointer;
        user-select: none; -webkit-user-select: none;
        transition: background .15s ease, transform .12s ease; }
      .pill:hover { background: rgba(255,255,255,.96); }
      .pill:active { transform: scale(.98); }
      .pill:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #34c759; flex: none; }
      .dot.warn { background: #ff9f0a; }
      .dot.err { background: #ff453a; }
      .amount { font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: .2px; }
      .badge { font-size: 10px; font-weight: 700; color: #b25000; background: #ffe7c2;
        border-radius: 999px; padding: 1px 6px; }
      .loading .amount { color: #8e8e93; font-weight: 500; }
      .sea { position: absolute; left: 0; bottom: calc(100% + 0px); width: 100%; height: 96px;
        overflow: hidden; pointer-events: none; z-index: 10; }
      .stage { position: absolute; inset: 0; }
      .pet { position: absolute; left: 0; bottom: 0; width: 72px; height: 42px;
        z-index: 3; pointer-events: auto; cursor: pointer; transform-origin: 50% 50%;
        will-change: transform; }
      .pet:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 4px; border-radius: 12px; }
      .pet .whale { width: 72px; height: 42px; display: block; overflow: visible;
        filter: drop-shadow(0 4px 5px rgba(20, 50, 120, .18)); }
      .pet.floating .whale { animation: whale-bob 3.4s ease-in-out infinite; }
      .pet.breaching .whale { animation: none; }
      .pet .spout { opacity: 0; transform-box: fill-box; transform-origin: center bottom; }
      .pet .spout.spouting { animation: spout 1.3s ease-out both; }
      .wave { position: absolute; left: 0; bottom: 0; width: 100%; height: 12px; pointer-events: none;
        animation: wave-drift 4.2s ease-in-out infinite alternate; }
      .wave.back { z-index: 1; opacity: .85; animation-delay: -2.1s; }
      .wave.front { z-index: 4; opacity: .96; }
      .splash { position: absolute; left: 0; bottom: 10px; width: 0; height: 0; z-index: 6;
        pointer-events: none; transform: translateX(-50%); }
      .splash i { position: absolute; left: 0; bottom: 0; width: 4px; height: 4px; border-radius: 50%;
        background: #eaf5ff; opacity: 0; }
      .splash.go i { animation: splash-drop .8s ease-out forwards; }
      .splash .foam { position: absolute; left: -20px; bottom: -3px; width: 40px; height: 7px;
        border-radius: 50%; background: rgba(255, 255, 255, .8); opacity: 0; }
      .splash.go .foam { animation: splash-foam .8s ease-out forwards; }
      .splash .ring { position: absolute; left: -18px; bottom: -3px; width: 36px; height: 8px;
        border: 1px solid rgba(255, 255, 255, .85); border-radius: 50%; opacity: 0; }
      .splash.go .ring { animation: splash-ring .8s ease-out forwards; }
      @keyframes whale-bob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(1.2px) rotate(-1deg); } }
      @keyframes wave-drift { from { transform: translateX(-1.2px); } to { transform: translateX(1.2px); } }
      @keyframes spout {
        0% { opacity: 0; transform: translateY(2px) scale(.5); }
        18% { opacity: 1; transform: translateY(0) scale(1); }
        70% { opacity: 1; transform: translateY(-4px) scale(1.06); }
        100% { opacity: 0; transform: translateY(-10px) scale(1.12); }
      }
      @keyframes splash-drop {
        0% { opacity: 0; transform: translate(0, 0) scale(.4); }
        12% { opacity: 1; }
        100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
      }
      @keyframes splash-foam {
        0% { opacity: 0; transform: scale(.4); }
        20% { opacity: .95; }
        100% { opacity: 0; transform: scale(1.9); }
      }
      @keyframes splash-ring {
        0% { opacity: .95; transform: scale(.4); }
        100% { opacity: 0; transform: scale(1.8); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pet .whale, .wave, .pet .spout { animation: none !important; }
      }
      .panel { pointer-events: auto; position: absolute; width: 278px; max-width: calc(100vw - 24px);
        max-height: min(72vh, 480px); overflow-y: auto;
        padding: 12px 13px; border-radius: 14px; border: 1px solid rgba(120,120,128,.22);
        background: rgba(255,255,255,.97); color: #1c1c1e;
        box-shadow: 0 10px 30px rgba(0,0,0,.16); backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px); display: none; }
      .panel.open { display: block; }
      .panel[data-side="right"] { right: 0; } .panel[data-side="left"] { left: 0; }
      .panel[data-vertical="up"] { bottom: calc(100% + 8px); } .panel[data-vertical="down"] { top: calc(100% + 8px); }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .title { font-size: 10.5px; font-weight: 700; color: #6e6e73; letter-spacing: 1px; }
      .refresh { all: unset; cursor: pointer; color: #6e6e73; font-size: 14px; line-height: 1;
        padding: 2px 5px; border-radius: 6px; }
      .refresh:hover { background: rgba(120,120,128,.14); color: #1c1c1e; }
      .refresh:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 1px; }
      .refresh.spin { animation: spin .8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .refresh.spin { animation: none; } }
      .tabs { display: flex; gap: 4px; margin: 9px 0 2px; padding: 3px; border-radius: 9px;
        background: rgba(120,120,128,.10); }
      .tab { all: unset; flex: 1; text-align: center; cursor: pointer; padding: 4px 0; border-radius: 7px;
        font-size: 11px; font-weight: 600; color: #6e6e73; }
      .tab:hover { color: #1c1c1e; }
      .tab.active { background: rgba(255,255,255,.96); color: #1c1c1e; box-shadow: 0 1px 3px rgba(0,0,0,.10); }
      .tab:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 1px; }
      .view[hidden] { display: none !important; }
      .total { margin-top: 7px; font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
      .rows { margin-top: 6px; display: grid; gap: 3px; }
      .row { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: #6e6e73; font-variant-numeric: tabular-nums; }
      .row b { font-weight: 600; color: #1c1c1e; }
      .warn { margin-top: 7px; font-size: 11px; color: #b25000; }
      .error { margin-top: 6px; font-size: 11px; color: #ff453a; }
      .hint { margin-top: 3px; font-size: 10.5px; color: #8e8e93; line-height: 1.45; }
      .meta { margin-top: 7px; padding-top: 7px; border-top: 1px solid rgba(120,120,128,.16); font-size: 10.5px; color: #8e8e93; }
      .today-link { all: unset; display: block; margin-top: 7px; padding-top: 7px; cursor: pointer;
        border-top: 1px solid rgba(120,120,128,.16); font-size: 10.5px; color: #4d6bfe; }
      .today-link:hover { text-decoration: underline; }
      .ranges { display: flex; gap: 4px; margin-top: 8px; }
      .range { all: unset; flex: 1; text-align: center; cursor: pointer; padding: 3px 0; border-radius: 6px;
        font-size: 10.5px; color: #6e6e73; background: rgba(120,120,128,.09); }
      .range:hover { color: #1c1c1e; }
      .range.active { background: rgba(77,107,254,.13); color: #3b55d9; font-weight: 600; }
      .range:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 1px; }
      .usage-total { margin-top: 9px; font-size: 21px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
      .usage-sub { margin-top: 2px; font-size: 10.5px; color: #6e6e73; font-variant-numeric: tabular-nums; }
      .bar { margin-top: 8px; height: 5px; border-radius: 999px; background: rgba(120,120,128,.16); overflow: hidden; }
      .bar i { display: block; height: 100%; width: 0; background: #4d6bfe; border-radius: inherit; transition: width .2s ease; }
      .bar.warn i { background: #ff9f0a; } .bar.err i { background: #ff453a; }
      .limit { margin-top: 4px; font-size: 10px; color: #8e8e93; font-variant-numeric: tabular-nums; }
      .usage-warn { margin-top: 7px; font-size: 11px; color: #ff453a; }
      .usage-list { margin-top: 8px; display: grid; gap: 2px; max-height: 180px; overflow-y: auto; }
      .u-row { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; align-items: baseline;
        padding: 3px 0; border-bottom: 1px solid rgba(120,120,128,.08); font-size: 10.5px; }
      .u-row:last-child { border-bottom: 0; }
      .u-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3a3a3c; }
      .u-tokens { font-variant-numeric: tabular-nums; font-weight: 600; color: #1c1c1e; }
      .u-span { font-variant-numeric: tabular-nums; color: #8e8e93; min-width: 44px; text-align: right; }
      .usage-meta { margin-top: 7px; padding-top: 7px; border-top: 1px solid rgba(120,120,128,.16);
        font-size: 9.5px; color: #8e8e93; line-height: 1.45; }
      .update-banner { margin-top: 8px; padding: 7px 9px; border-radius: 9px; display: flex;
        align-items: center; justify-content: space-between; gap: 8px;
        background: rgba(77, 107, 254, .12); border: 1px solid rgba(77, 107, 254, .22); }
      .update-text { font-size: 10.5px; color: #3b55d9; }
      .update-btn { all: unset; cursor: pointer; font-size: 10.5px; font-weight: 600; color: #fff;
        background: #4d6bfe; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
      .update-btn:disabled { opacity: .6; cursor: default; }
      .space-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
      .scan-btn, .clean-btn { all: unset; cursor: pointer; font-size: 10.5px; font-weight: 600;
        color: #3b55d9; background: rgba(77, 107, 254, .12); padding: 4px 9px; border-radius: 7px; }
      .clean-btn { color: #fff; background: #4d6bfe; }
      .clean-btn:disabled { opacity: .4; cursor: default; }
      .space-free { font-size: 10px; color: #8e8e93; font-variant-numeric: tabular-nums; }
      .disk-list { margin-top: 8px; display: grid; gap: 2px; max-height: 250px; overflow-y: auto; }
      .disk-row { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 7px;
        align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(120, 120, 128, .08);
        font-size: 10.5px; }
      .disk-row:last-child { border-bottom: 0; }
      .disk-row input { width: 12px; height: 12px; margin: 0; accent-color: #4d6bfe; }
      .disk-row.readonly { opacity: .72; }
      .disk-row.readonly .disk-check { visibility: hidden; }
      .disk-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3a3a3c; }
      .disk-sub { display: block; font-size: 9px; color: #8e8e93; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .disk-size { font-variant-numeric: tabular-nums; font-weight: 600; color: #1c1c1e; white-space: nowrap; }
      .disk-tag { font-size: 8.5px; color: #8e8e93; margin-left: 4px; }
      .disk-tag.over { color: #b25000; }
      .disk-meta { margin-top: 7px; font-size: 9.5px; color: #8e8e93; line-height: 1.45; }
      .disk-threshold { display: flex; align-items: center; gap: 4px; font-size: 9.5px; color: #8e8e93; }
      .disk-threshold input { width: 44px; box-sizing: border-box; border: 1px solid rgba(120, 120, 128, .22);
        background: transparent; color: inherit; border-radius: 5px; padding: 2px 4px; font: inherit;
        font-variant-numeric: tabular-nums; }
      .disk-threshold input:focus { outline: 1px solid #4d6bfe; outline-offset: 1px; }
      [hidden] { display: none !important; }
      @media (prefers-color-scheme: dark) {
        .pill { background: rgba(28,28,30,.84); color: #f2f2f7; border-color: rgba(255,255,255,.16); }
        .pill:hover { background: rgba(44,44,46,.96); }
        .panel { background: rgba(28,28,30,.97); color: #f2f2f7; border-color: rgba(255,255,255,.16); }
        .title, .row, .refresh, .usage-sub, .u-name { color: #aeaeb2; }
        .row b, .u-tokens { color: #f2f2f7; }
        .refresh:hover { color: #f2f2f7; background: rgba(255,255,255,.10); }
        .meta, .usage-meta, .limit, .u-span { color: #8e8e93; border-top-color: rgba(255,255,255,.12); }
        .badge { color: #ffd60a; background: rgba(255,214,10,.16); }
        .warn { color: #ffd60a; }
        .tabs { background: rgba(255,255,255,.08); }
        .tab { color: #aeaeb2; } .tab:hover { color: #f2f2f7; }
        .tab.active { background: rgba(255,255,255,.14); color: #f2f2f7; }
        .range { background: rgba(255,255,255,.08); color: #aeaeb2; }
        .range:hover { color: #f2f2f7; }
        .range.active { background: rgba(77,107,254,.24); color: #aab8ff; }
        .bar { background: rgba(255,255,255,.14); }
        .today-link { border-top-color: rgba(255,255,255,.12); color: #8fa2ff; }
        .u-row { border-bottom-color: rgba(255,255,255,.07); }
        .update-banner { background: rgba(77,107,254,.18); border-color: rgba(120,150,255,.28); }
        .update-text { color: #aab8ff; }
        .disk-name { color: #d1d1d6; }
        .disk-size { color: #f2f2f7; }
        .disk-row { border-bottom-color: rgba(255,255,255,.07); }
        .scan-btn { color: #aab8ff; background: rgba(77,107,254,.22); }
        .disk-threshold input { border-color: rgba(255,255,255,.18); }
      }
    </style>
    <div class="wrap">
      <div class="sea">
        <svg class="wave back" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="q-wb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#9db6ff"/><stop offset="1" stop-color="#3f5fdf"/>
            </linearGradient>
            <linearGradient id="q-fade-b" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#000"/><stop offset=".06" stop-color="#fff"/><stop offset=".94" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
            </linearGradient>
            <mask id="q-mask-b"><rect width="200" height="14" fill="url(#q-fade-b)"/></mask>
          </defs>
          <g mask="url(#q-mask-b)">
            <path d="M0 9 C20 3 40 3 60 9 C80 15 100 15 120 9 C140 3 160 3 180 9 C190 12 196 12 200 10 L200 14 L0 14 Z" fill="url(#q-wb)"/>
          </g>
        </svg>
        <div class="stage">
          <div class="pet" role="button" tabindex="0" aria-label="${text.petTitle}" title="${text.petTitle}">
            <svg class="whale" viewBox="0 0 78 46" aria-hidden="true">
          <defs>
            <radialGradient id="q-body" cx="34%" cy="24%" r="82%">
              <stop offset="0" stop-color="#e8efff"/><stop offset=".2" stop-color="#a7bbff"/><stop offset=".55" stop-color="#5876f8"/><stop offset="1" stop-color="#14288f"/>
            </radialGradient>
            <radialGradient id="q-tail" cx="35%" cy="30%" r="85%">
              <stop offset="0" stop-color="#a8bbff"/><stop offset=".55" stop-color="#4c68ef"/><stop offset="1" stop-color="#14288f"/>
            </radialGradient>
            <linearGradient id="q-belly" x1="0" y1="30" x2="0" y2="48">
              <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#dde7ff"/><stop offset="1" stop-color="#9db1ff"/>
            </linearGradient>
            <linearGradient id="q-board" x1="0" y1="48" x2="0" y2="62">
              <stop offset="0" stop-color="#ffd9a0"/><stop offset=".45" stop-color="#ff9a3d"/><stop offset="1" stop-color="#c95f0f"/>
            </linearGradient>
            <filter id="q-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.8"/></filter>
            <filter id="q-soft-sm" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1"/></filter>
          </defs>
          <path d="M17 25 C11 17 5 14 2 16 C4 20 5 22 6 25 C5 28 3 32 1 36 C5 37 11 33 17 28 Z" fill="url(#q-tail)"/>
          <path d="M14 26 C11 23 9 21 8 19" stroke="#0d1c66" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".5"/>
          <path d="M13 28 C10 31 9 33 8 35" stroke="#cdd9ff" stroke-width="1" fill="none" stroke-linecap="round" opacity=".55"/>
          <path d="M64 27 C61 16 49 10 34 12 C24 13 18 17 15 23 C13 28 16 34 23 37 C33 42 51 42 59 35 C63 32 65 29 64 27 Z" fill="url(#q-body)"/>
          <ellipse cx="38" cy="17" rx="15" ry="6" fill="#ffffff" opacity=".4" filter="url(#q-soft)" transform="rotate(-8 38 17)"/>
          <path d="M21 32 C28 42 48 43 57 34 C50 42 30 42 21 32 Z" fill="url(#q-belly)"/>
          <path d="M22 36 C31 44 50 44 58 36 C53 46 32 47 22 36 Z" fill="#07144f" opacity=".35" filter="url(#q-soft-sm)"/>
          <path d="M19 18 C29 10 48 12 56 22" stroke="#f4f8ff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
          <path d="M40 12 C42 6 46 6 48 12 Z" fill="url(#q-body)" stroke="#14288f" stroke-width=".5"/>
          <path d="M38 37 C34 44 39 49 47 49 C44 44 45 39 49 36 Z" fill="url(#q-body)"/>
          <path d="M39 38 C37 42 41 46 45 47" stroke="#dbe5ff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".5"/>
          <ellipse cx="56" cy="25" rx="2.7" ry="3" fill="#0b1645" opacity=".4"/>
          <ellipse cx="56" cy="25" rx="2" ry="2.3" fill="#ffffff"/>
          <circle cx="56.5" cy="25.3" r="1.15" fill="#0e173f"/>
          <circle cx="55.9" cy="24.4" r=".5" fill="#ffffff"/>
          <circle cx="57.1" cy="26" r=".26" fill="#ffffff" opacity=".85"/>
          <path d="M53.4 22.8 C54.6 21.6 57.6 21.5 58.8 22.8" stroke="#0e173f" stroke-width=".9" fill="none" stroke-linecap="round" opacity=".4"/>
          <path d="M63 31 C60 34 56 35 52 35" stroke="#0e173f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <path d="M62.5 32.2 C60 35 56.5 36 53 36" stroke="#e7efff" stroke-width="1" fill="none" stroke-linecap="round" opacity=".55"/>
          <ellipse cx="59" cy="30" rx="2.2" ry="1.1" fill="#ff9bb0" opacity=".18"/>
          <ellipse cx="42" cy="12" rx="1.2" ry=".7" fill="#14288f" opacity=".55"/>
          <g class="spout">
            <path d="M41 9 C40 3 35 1 31 4" stroke="#c4eaff" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".95"/>
            <path d="M41 9 C42 3 46 1 49 4" stroke="#c4eaff" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".95"/>
            <circle cx="31" cy="2.5" r="1.2" fill="#eaf6ff"/>
            <circle cx="49.5" cy="2.5" r="1.1" fill="#eaf6ff"/>
            <circle cx="39" cy=".8" r=".9" fill="#eaf6ff" opacity=".9"/>
          </g>
        </svg>
          </div>
        </div>
        <svg class="wave front" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="q-wf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#e6efff"/><stop offset=".45" stop-color="#a8c1ff"/><stop offset="1" stop-color="#5b7bf2"/>
            </linearGradient>
            <linearGradient id="q-ff" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="1" stop-color="#ffffff" stop-opacity=".15"/>
            </linearGradient>
            <linearGradient id="q-fade-f" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#000"/><stop offset=".06" stop-color="#fff"/><stop offset=".94" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
            </linearGradient>
            <mask id="q-mask-f"><rect width="200" height="14" fill="url(#q-fade-f)"/></mask>
          </defs>
          <g mask="url(#q-mask-f)">
            <path d="M0 9 C20 3 40 3 60 9 C80 15 100 15 120 9 C140 3 160 3 180 9 C190 12 196 12 200 10 L200 14 L0 14 Z" fill="url(#q-wf)"/>
            <path d="M2 9 C21 4 41 4 61 9 C81 14 101 14 121 9 C141 4 161 4 181 9" stroke="url(#q-ff)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
            <circle cx="40" cy="6" r="1.2" fill="#f4f9ff" opacity=".8"/>
            <circle cx="100" cy="4" r="1" fill="#f4f9ff" opacity=".7"/>
            <circle cx="160" cy="6" r="1.1" fill="#f4f9ff" opacity=".75"/>
          </g>
        </svg>
      </div>
      <button class="pill loading" type="button" aria-live="polite" aria-haspopup="dialog" aria-expanded="false">
        <span class="dot"></span><span class="amount">${text.loading}</span><span class="badge" hidden></span>
      </button>
      <div class="panel" role="dialog" aria-label="QuotaPot" data-side="right" data-vertical="up">
        <div class="head"><span class="title">${text.title}</span><button class="refresh" type="button" title="${text.refresh}" aria-label="${text.refresh}">↻</button></div>
        <div class="update-banner" hidden>
          <span class="update-text"></span>
          <button class="update-btn" type="button"></button>
        </div>
        <div class="tabs" role="tablist">
          <button class="tab active" type="button" role="tab" data-tab="balance" aria-selected="true">${text.balanceTab}</button>
          <button class="tab" type="button" role="tab" data-tab="usage" aria-selected="false">${text.usageTab}</button>
          <button class="tab" type="button" role="tab" data-tab="space" aria-selected="false">${text.spaceTab}</button>
        </div>
        <div class="view balance-view">
          <div class="total">--</div>
          <div class="rows"></div>
          <div class="warn" hidden></div>
          <div class="error" hidden></div>
          <div class="hint" hidden></div>
          <button class="today-link" type="button" hidden></button>
          <div class="meta">${text.loading}</div>
        </div>
        <div class="view usage-view" hidden>
          <div class="ranges">
            <button class="range active" type="button" data-days="1">${text.today}</button>
            <button class="range" type="button" data-days="7">${text.sevenDays}</button>
            <button class="range" type="button" data-days="30">${text.thirtyDays}</button>
          </div>
          <div class="usage-total">--</div>
          <div class="usage-sub"></div>
          <div class="bar" hidden><i></i></div>
          <div class="limit"></div>
          <div class="usage-warn" hidden></div>
          <div class="usage-list"></div>
          <div class="usage-meta">${text.loading}</div>
        </div>
        <div class="view space-view" hidden>
          <div class="space-actions">
            <button class="scan-btn" type="button">${text.scan}</button>
            <span class="space-free"></span>
          </div>
          <div class="disk-list"></div>
          <div class="space-actions">
            <label class="disk-threshold">${text.diskThreshold}
              <input class="disk-threshold-input" type="number" min="1" step="1" inputmode="numeric" aria-label="${text.diskThreshold}">
              GB
            </label>
            <button class="clean-btn" type="button" disabled>${text.cleanSelected}</button>
          </div>
          <div class="disk-meta">${text.diskHint}</div>
        </div>
      </div>
    </div>
  `

  const pill = root.querySelector('.pill')
  const sea = root.querySelector('.sea')
  const pet = root.querySelector('.pet')
  const spout = root.querySelector('.spout')
  const dot = root.querySelector('.dot')
  const amount = root.querySelector('.amount')
  const badge = root.querySelector('.badge')
  const panel = root.querySelector('.panel')
  const refresh = root.querySelector('.refresh')
  const tabs = [...root.querySelectorAll('.tab')]
  const ranges = [...root.querySelectorAll('.range')]
  const updateBanner = root.querySelector('.update-banner')
  const updateText = root.querySelector('.update-text')
  const updateBtn = root.querySelector('.update-btn')
  const spaceView = root.querySelector('.space-view')
  const scanBtn = root.querySelector('.scan-btn')
  const spaceFree = root.querySelector('.space-free')
  const diskList = root.querySelector('.disk-list')
  const cleanBtn = root.querySelector('.clean-btn')
  const diskMeta = root.querySelector('.disk-meta')
  const thresholdInput = root.querySelector('.disk-threshold-input')
  const balanceView = root.querySelector('.balance-view')
  const usageView = root.querySelector('.usage-view')
  const total = root.querySelector('.total')
  const rows = root.querySelector('.rows')
  const warn = root.querySelector('.warn')
  const error = root.querySelector('.error')
  const hint = root.querySelector('.hint')
  const meta = root.querySelector('.meta')
  const todayLink = root.querySelector('.today-link')
  const usageTotal = root.querySelector('.usage-total')
  const usageSub = root.querySelector('.usage-sub')
  const bar = root.querySelector('.bar')
  const barFill = bar.querySelector('i')
  const limitText = root.querySelector('.limit')
  const usageWarn = root.querySelector('.usage-warn')
  const usageList = root.querySelector('.usage-list')
  const usageMeta = root.querySelector('.usage-meta')

  const panelSide = position.endsWith('left') ? 'left' : 'right'
  const panelVertical = position.startsWith('top') ? 'down' : 'up'
  panel.dataset.side = panelSide
  panel.dataset.vertical = panelVertical

  const state = {
    open: false, tab: 'balance', days: 1,
    loading: false, data: null, usage: null, usageLoading: false,
    disk: null, diskLoading: false, selected: new Set(), cleanConfirm: false, cleanResult: '', diskThreshold: null,
    update: null, updatePhase: 'idle', updateError: '',
  }

  const symbolOf = (currency) => ({ CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€', JPY: '¥' }[currency] || `${currency} `)
  const numberFormat = new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const compactFormat = new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 })
  const exactFormat = new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US')
  const money = (value) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return String(value || '—')
    if (number > 0 && number < 0.01) return '<0.01'
    return numberFormat.format(number)
  }
  const fmtTokens = (value) => compactFormat.format(Number(value) || 0)
  const fmtExact = (value) => exactFormat.format(Number(value) || 0)
  const fmtSpan = (ms) => {
    const minutes = Math.round((Number(ms) || 0) / 60000)
    if (minutes <= 0) return '—'
    if (minutes < 60) return zh ? `${minutes} 分` : `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    if (hours < 24) return zh ? `${hours} 小时${rest ? ` ${rest} 分` : ''}` : `${hours}h${rest ? ` ${rest}m` : ''}`
    const days = Math.floor(hours / 24)
    const h = hours % 24
    return zh ? `${days} 天${h ? ` ${h} 小时` : ''}` : `${days}d${h ? ` ${h}h` : ''}`
  }
  const primary = () => {
    const list = state.data?.balances ?? []
    return list.find(item => item.currency === 'CNY') || list[0] || null
  }
  const kindLabel = (kind) => ({ bot: text.bot, group: text.group, agent: text.agent, other: text.other }[kind] || text.bot)
  const displayName = (owner) => {
    const name = String(owner?.name || '')
    if (name && name !== owner?.key) return name
    const id = String(owner?.key || '').split(':').pop().replace(/^session-/, '')
    return `${kindLabel(owner?.kind)} ${id.slice(0, 6)}`
  }
  const errorText = (code) => {
    if (code === 'NO_KEY') return { message: text.noKey, hint: zh ? '支持环境变量、DSH 凭据存储和 ~/.dsh/.credentials.yaml。' : 'Env var, DSH credential store, and ~/.dsh/.credentials.yaml are checked.' }
    if (code === 'AUTH') return { message: text.auth, hint: zh ? '在 设置 → 模型 中更新 DeepSeek API Key。' : 'Update the DeepSeek API key in Settings → Models.' }
    if (code === 'RATE_LIMIT') return { message: text.rate, hint: '' }
    if (code === 'NETWORK') return { message: text.network, hint: '' }
    if (code === 'UNAUTHORIZED') return { message: text.reload, hint: '' }
    return { message: code ? `HTTP ${String(code).replace(/^HTTP /, '')}` : text.network, hint: '' }
  }

  function exceededNow() {
    return Boolean(state.data?.usage?.exceeded || state.usage?.daily?.exceeded)
  }

  function renderPill() {
    const data = state.data
    const item = primary()
    const ok = data?.ok === true
    const low = ok && item && Number(item.total) > 0 && Number(item.total) < threshold
    const insufficient = ok && item && (data.isAvailable === false || Number(item.total) <= 0)
    const exceeded = exceededNow()
    dot.className = 'dot' + ((data && !ok) || insufficient || exceeded ? ' err' : low ? ' warn' : '')

    if (ok && item) {
      pill.classList.remove('loading')
      amount.textContent = `${symbolOf(item.currency)}${money(item.total)}`
      pill.title = `QuotaPot · ${item.currency} ${money(item.total)}` + (state.data?.usage ? ` · ${text.today} ${fmtTokens(state.data.usage.todayTokens)}` : '')
    } else if (data && !ok) {
      pill.classList.remove('loading')
      amount.textContent = text.unavailable
      pill.title = `QuotaPot · ${errorText(data.error).message}`
    } else {
      pill.classList.add('loading')
      amount.textContent = text.loading
    }

    const badgeText = insufficient ? '!' : exceeded ? (zh ? '超' : 'LIMIT') : low ? (zh ? '低' : 'LOW') : ''
    badge.hidden = !badgeText
    badge.textContent = badgeText
    pill.setAttribute('aria-expanded', String(state.open))
  }

  function renderBalance() {
    const data = state.data
    const item = primary()
    const ok = data?.ok === true
    const low = ok && item && Number(item.total) > 0 && Number(item.total) < threshold
    const insufficient = ok && item && (data.isAvailable === false || Number(item.total) <= 0)

    if (ok && item) {
      total.textContent = `${symbolOf(item.currency)}${money(item.total)}`
      rows.replaceChildren()
      const addRow = (labelText, valueText) => {
        const row = document.createElement('div')
        row.className = 'row'
        const label = document.createElement('span')
        label.textContent = labelText
        const detail = document.createElement('b')
        detail.textContent = valueText
        row.append(label, detail)
        rows.append(row)
      }
      if (data.balances.length === 1) {
        addRow(text.topUpBalance, `${symbolOf(item.currency)}${money(item.toppedUp)}`)
        addRow(text.grantedBalance, `${symbolOf(item.currency)}${money(item.granted)}`)
      } else {
        for (const entry of data.balances) {
          addRow(entry.currency, `${symbolOf(entry.currency)}${money(entry.total)}`)
        }
      }
      warn.hidden = !(low || insufficient)
      warn.textContent = insufficient ? text.insufficient : low ? `${text.low} (< ${symbolOf(item.currency)}${money(threshold)})` : ''
      error.hidden = true
      hint.hidden = true
      meta.textContent = `${text.updated} ${new Date(data.updatedAt).toLocaleTimeString(zh ? 'zh-CN' : 'en-US', { hour12: false })}`
      const usage = state.data?.usage
      if (usage && Number.isFinite(usage.todayTokens)) {
        todayLink.hidden = false
        todayLink.textContent = `${text.todayTokens} ${fmtTokens(usage.todayTokens)} · ${text.viewUsage}`
      } else {
        todayLink.hidden = true
      }
    } else if (data && !ok) {
      const info = errorText(data.error)
      total.textContent = '--'
      rows.replaceChildren()
      warn.hidden = true
      error.hidden = false
      error.textContent = info.message
      hint.hidden = !info.hint
      hint.textContent = info.hint
      todayLink.hidden = true
      meta.textContent = info.message
    } else {
      total.textContent = '--'
      rows.replaceChildren()
      warn.hidden = true
      error.hidden = true
      hint.hidden = true
      todayLink.hidden = true
      meta.textContent = text.loading
    }
  }

  function renderUsage() {
    ranges.forEach(range => range.classList.toggle('active', Number(range.dataset.days) === state.days))
    const usage = state.usage
    usageList.replaceChildren()
    usageWarn.hidden = true
    bar.hidden = true
    limitText.textContent = ''

    if (state.usageLoading && !usage) {
      usageTotal.textContent = '--'
      usageSub.textContent = text.loading
      usageMeta.textContent = text.loading
      return
    }
    if (!usage) {
      usageTotal.textContent = '--'
      usageSub.textContent = ''
      usageMeta.textContent = text.loading
      return
    }
    if (!usage.ok) {
      usageTotal.textContent = '--'
      usageSub.textContent = ''
      usageMeta.textContent = usage.error === 'NO_USAGE' || usage.error === 'NO_SQLITE' ? text.noUsage : text.usageUnavailable
      return
    }

    const totals = usage.totals || { tokens: 0, calls: 0, spanMs: 0 }
    usageTotal.textContent = fmtTokens(totals.tokens)
    usageTotal.title = `${fmtExact(totals.tokens)} ${text.tokens}`
    const rangeLabel = state.days === 1 ? text.today : state.days === 7 ? text.sevenDays : text.thirtyDays
    usageSub.textContent = `${rangeLabel} · ${text.spanTotal} ${fmtSpan(totals.spanSumMs ?? totals.spanMs)} · ${fmtExact(totals.calls)} ${text.calls}`

    const daily = usage.daily
    if (daily && daily.limit > 0) {
      const pct = Math.min(100, Math.round(daily.tokens / daily.limit * 100))
      bar.hidden = false
      bar.classList.toggle('err', daily.exceeded)
      bar.classList.toggle('warn', !daily.exceeded && pct >= 80)
      barFill.style.width = `${Math.max(2, pct)}%`
      limitText.textContent = `${text.dailyLimit} ${fmtTokens(daily.limit)} · ${pct}%`
      if (daily.exceeded) {
        usageWarn.hidden = false
        usageWarn.textContent = `${text.overLimit}：${fmtTokens(daily.tokens)} / ${fmtTokens(daily.limit)}`
      }
    } else {
      limitText.textContent = text.noLimit
    }

    const owners = usage.owners ?? []
    if (owners.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'u-row'
      empty.textContent = text.noUsage
      usageList.append(empty)
    } else {
      for (const owner of owners.slice(0, 10)) {
        const row = document.createElement('div')
        row.className = 'u-row'
        const name = document.createElement('span')
        name.className = 'u-name'
        name.textContent = displayName(owner)
        name.title = owner.name || owner.key || ''
        const tokens = document.createElement('span')
        tokens.className = 'u-tokens'
        tokens.textContent = fmtTokens(owner.tokens)
        tokens.title = `${fmtExact(owner.tokens)} ${text.tokens}`
        const span = document.createElement('span')
        span.className = 'u-span'
        span.textContent = fmtSpan(owner.spanMs)
        row.append(name, tokens, span)
        usageList.append(row)
      }
    }
    usageMeta.textContent = text.usageHint
  }

  function render() {
    tabs.forEach(tab => {
      const active = tab.dataset.tab === state.tab
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
    })
    ranges.forEach(range => range.classList.toggle('active', Number(range.dataset.days) === state.days))
    balanceView.hidden = state.tab !== 'balance'
    usageView.hidden = state.tab !== 'usage'
    spaceView.hidden = state.tab !== 'space'
    panel.classList.toggle('open', state.open)
    pill.setAttribute('aria-expanded', String(state.open))
    refresh.classList.toggle('spin', state.loading || state.usageLoading || state.diskLoading)
    renderPill()
    renderUpdate()
    if (state.tab === 'balance') renderBalance()
    else if (state.tab === 'usage') renderUsage()
    else renderSpace()
    requestAnimationFrame(syncPetAnchor)
  }

  async function loadBalance(force) {
    if (state.loading) return
    state.loading = true
    render()
    try {
      const response = await fetch(`/quotapot/balance${force ? '?fresh=1' : ''}`, {
        cache: 'no-store',
        headers: { accept: 'application/json', 'x-quotapot-token': token },
      })
      if (response.status === 401) {
        state.data = { ok: false, error: 'UNAUTHORIZED', updatedAt: Date.now() }
      } else {
        state.data = await response.json()
      }
    } catch {
      state.data = { ok: false, error: 'NETWORK', updatedAt: Date.now() }
    }
    state.loading = false
    render()
  }

  async function loadUsage(days, force) {
    if (state.usageLoading) return
    state.usageLoading = true
    render()
    try {
      const response = await fetch(`/quotapot/usage?days=${days}${force ? '&fresh=1' : ''}`, {
        cache: 'no-store',
        headers: { accept: 'application/json', 'x-quotapot-token': token },
      })
      state.usage = response.status === 401
        ? { ok: false, error: 'UNAUTHORIZED' }
        : await response.json()
    } catch {
      state.usage = { ok: false, error: 'NETWORK' }
    }
    state.usageLoading = false
    render()
  }

  function formatBytes(bytes) {
    const number = Number(bytes)
    if (!Number.isFinite(number) || number < 0) return '—'
    if (number >= 1073741824) return `${(number / 1073741824).toFixed(2)} GB`
    if (number >= 1048576) return `${(number / 1048576).toFixed(1)} MB`
    if (number >= 1024) return `${(number / 1024).toFixed(0)} KB`
    return `${number} B`
  }

  function shortPath(path) {
    return String(path || '')
      .replace(/^\/Users\/[^/]+/, '~')
      .replace(/^\/home\/[^/]+/, '~')
      .replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
  }

  async function checkUpdate(force = false) {
    try {
      const response = await fetch(`/quotapot/update-check${force ? '?fresh=1' : ''}`, {
        cache: 'no-store',
        headers: { accept: 'application/json', 'x-quotapot-token': token },
      })
      if (!response.ok) return
      const data = await response.json()
      state.update = data
      if (!data?.available) { state.updatePhase = 'idle'; state.updateError = '' }
      renderUpdate()
    } catch { /* offline: keep the last answer */ }
  }

  async function runUpdate() {
    if (!state.update?.available) return
    if (state.updatePhase === 'idle' || state.updatePhase === 'error') {
      state.updatePhase = 'confirm'
      state.updateError = ''
      renderUpdate()
      return
    }
    if (state.updatePhase !== 'confirm') return
    state.updatePhase = 'installing'
    renderUpdate()
    try {
      const response = await fetch('/quotapot/update', {
        method: 'POST',
        cache: 'no-store',
        headers: { accept: 'application/json', 'x-quotapot-token': token },
      })
      const data = await response.json()
      if (data?.ok) {
        state.updatePhase = 'done'
        state.updateError = ''
      } else {
        state.updatePhase = 'error'
        state.updateError = String(data?.error || 'FAILED')
      }
    } catch {
      state.updatePhase = 'error'
      state.updateError = 'NETWORK'
    }
    renderUpdate()
  }

  function renderUpdate() {
    const info = state.update
    const show = Boolean(info?.available)
    updateBanner.hidden = !show
    if (!show) return
    const version = info.latest ? `v${info.latest}` : ''
    if (state.updatePhase === 'installing') {
      updateText.textContent = `${text.updating} ${version}`
      updateBtn.textContent = text.updating
      updateBtn.disabled = true
    } else if (state.updatePhase === 'done') {
      updateText.textContent = `${version} · ${text.updateDone}`
      updateBtn.textContent = '✓'
      updateBtn.disabled = true
    } else if (state.updatePhase === 'error') {
      updateText.textContent = `${text.updateFailed}: ${state.updateError || ''}`
      updateBtn.textContent = text.update
      updateBtn.disabled = false
    } else if (state.updatePhase === 'confirm') {
      updateText.textContent = `${text.updateFound} ${version} · ${text.updateConfirm}?`
      updateBtn.textContent = text.updateConfirm
      updateBtn.disabled = false
    } else {
      updateText.textContent = `${text.updateFound} ${version}`
      updateBtn.textContent = text.update
      updateBtn.disabled = false
    }
  }

  async function loadDisk(force = false) {
    if (state.diskLoading) return
    state.diskLoading = true
    renderSpace()
    try {
      const response = await fetch(`/quotapot/disk${force ? '?fresh=1' : ''}`, {
        cache: 'no-store',
        headers: { accept: 'application/json', 'x-quotapot-token': token },
      })
      state.disk = response.status === 401
        ? { ok: false, error: 'UNAUTHORIZED' }
        : await response.json()
    } catch {
      state.disk = { ok: false, error: 'NETWORK' }
    }
    state.diskLoading = false
    state.selected.clear()
    state.cleanConfirm = false
    renderSpace()
    requestAnimationFrame(syncPetAnchor)
  }

  function renderSpace() {
    const disk = state.disk
    scanBtn.textContent = state.diskLoading ? text.scanning : text.scan
    scanBtn.disabled = state.diskLoading
    spaceFree.textContent = disk?.ok && Number.isFinite(disk.free) ? `${text.free} ${formatBytes(disk.free)}` : ''
    diskList.replaceChildren()
    cleanBtn.disabled = true
    cleanBtn.textContent = text.cleanSelected
    if (!disk) {
      diskMeta.textContent = text.diskHint
      return
    }
    if (!disk.ok) {
      diskMeta.textContent = disk.error === 'UNAUTHORIZED' ? text.reload : (state.diskLoading ? text.scanning : text.scanFailed)
      return
    }
    if (state.diskLoading) {
      diskMeta.textContent = text.scanning
      return
    }
    const thresholdGB = Number(state.diskThreshold) || Number(disk.thresholdGB) || 3
    if (thresholdInput && document.activeElement !== thresholdInput) thresholdInput.value = String(thresholdGB)
    const threshold = thresholdGB * 1073741824
    const items = (disk.items || [])
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'disk-meta'
      empty.textContent = text.noDisk
      diskList.append(empty)
    }
    for (const item of items) {
      const row = document.createElement('div')
      row.className = 'disk-row' + (item.safe ? '' : ' readonly')
      row.title = item.hint ? `${item.label} — ${item.hint}` : item.path
      const check = document.createElement('span')
      if (item.safe) {
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = state.selected.has(item.id)
        input.addEventListener('change', () => {
          if (input.checked) state.selected.add(item.id)
          else state.selected.delete(item.id)
          state.cleanConfirm = false
          renderSpace()
        })
        check.append(input)
      } else {
        check.className = 'disk-check'
        check.textContent = '·'
      }
      const nameWrap = document.createElement('div')
      const name = document.createElement('span')
      name.className = 'disk-name'
      name.textContent = item.label
      const sub = document.createElement('span')
      sub.className = 'disk-sub'
      sub.textContent = shortPath(item.path)
      sub.title = item.path
      nameWrap.append(name, sub)
      const sizeWrap = document.createElement('div')
      const size = document.createElement('span')
      size.className = 'disk-size'
      size.textContent = formatBytes(item.size)
      const tag = document.createElement('span')
      tag.className = 'disk-tag' + (item.size >= threshold ? ' over' : '')
      tag.textContent = item.size >= threshold
        ? `${text.over} ${thresholdGB}GB${item.safe ? '' : ` · ${text.readOnly}`}`
        : (item.safe ? text.safeTag : text.readOnly)
      sizeWrap.append(size, tag)
      row.append(check, nameWrap, sizeWrap)
      diskList.append(row)
    }
    const count = state.selected.size
    cleanBtn.disabled = count === 0
    cleanBtn.textContent = state.cleanConfirm
      ? `${text.confirmClean} (${count})`
      : `${text.cleanSelected} (${count})`
    diskMeta.textContent = state.cleanResult || text.diskHint
  }

  async function cleanSelected() {
    const ids = [...state.selected]
    if (ids.length === 0) return
    if (!state.cleanConfirm) {
      state.cleanConfirm = true
      renderSpace()
      return
    }
    state.diskLoading = true
    state.cleanResult = ''
    renderSpace()
    try {
      const response = await fetch('/quotapot/disk/clean', {
        method: 'POST',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-quotapot-token': token },
        body: JSON.stringify({ ids }),
      })
      const data = await response.json()
      if (data?.ok || Number(data?.freed) > 0) {
        state.cleanResult = `${text.freed} ${formatBytes(data.freed)}`
      } else {
        state.cleanResult = `${text.cleanFailed}: ${String(data?.error || '').slice(0, 80)}`
      }
    } catch {
      state.cleanResult = text.cleanFailed
    }
    state.diskLoading = false
    state.selected.clear()
    state.cleanConfirm = false
    await loadDisk(true)
    renderSpace()
  }

  try {
    const savedThreshold = Number(localStorage.getItem('quotapot.diskThresholdGB'))
    if (Number.isFinite(savedThreshold) && savedThreshold > 0) state.diskThreshold = savedThreshold
  } catch { /* storage may be unavailable */ }

  let breaching = false
  let running = false
  let petCardOpen = null
  let breachAnim = null
  let breachTimer = null
  let splashTimer1 = null
  let splashTimer2 = null
  let spoutTimer = null
  let spoutReset = null

  function cardBase() {
    return state.open ? pill.offsetWidth - panel.offsetWidth : 0
  }

  function seaWidth() {
    return sea.clientWidth || pill.offsetWidth
  }

  function maxX() {
    return Math.max(12, seaWidth() - pet.offsetWidth)
  }

  function midX() {
    return maxX() / 2
  }

  function setFloat() {
    clearTimeout(breachTimer)
    breachTimer = null
    breaching = false
    if (breachAnim !== null) { breachAnim.cancel(); breachAnim = null }
    pet.classList.remove('breaching')
    pet.classList.add('floating')
    pet.style.transform = `translateX(${midX()}px) translateY(0px) rotate(0deg)`
  }

  function syncPetAnchor() {
    const offset = state.open ? 8 + panel.offsetHeight : 0
    const base = cardBase()
    const card = state.open ? panel : pill
    sea.style.left = `${base}px`
    sea.style.width = `${card.offsetWidth}px`
    sea.style.bottom = `calc(100% + ${offset}px)`
    if (petCardOpen !== state.open) {
      petCardOpen = state.open
      setFloat()
      if (running) startBreachLoop()
    }
  }

  function spawnSplash(x) {
    const el = document.createElement('div')
    el.className = 'splash'
    el.style.left = `${x}px`
    const colors = ['#eaf5ff', '#ffffff', '#bcd8ff', '#9dc0ff']
    let html = '<span class="foam"></span><span class="ring"></span>'
    for (let i = 0; i < 12; i++) {
      const angle = -Math.PI * (0.12 + Math.random() * 0.76)
      const dist = 14 + Math.random() * 28
      const dx = Math.cos(angle) * dist
      const dy = Math.sin(angle) * dist
      const size = 3 + Math.random() * 3.5
      html += `<i style="--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;background:${colors[i % colors.length]}"></i>`
    }
    el.innerHTML = html
    sea.appendChild(el)
    requestAnimationFrame(() => el.classList.add('go'))
    setTimeout(() => el.remove(), 900)
  }

  function breachOnce() {
    if (breaching) return
    breaching = true
    clearTimeout(breachTimer)
    breachTimer = null
    pet.classList.remove('floating')
    pet.classList.add('breaching')
    const max = maxX()
    const mid = max / 2
    const anim = pet.animate([
      { transform: `translateX(${mid}px) translateY(0px) rotate(0deg)`, offset: 0 },
      { transform: `translateX(${mid}px) translateY(18px) rotate(0deg)`, offset: 0.12 },
      { transform: `translateX(${max * 0.14}px) translateY(0px) rotate(-30deg)`, offset: 0.26 },
      { transform: `translateX(${max * 0.4}px) translateY(-18px) rotate(-8deg)`, offset: 0.42 },
      { transform: `translateX(${max * 0.54}px) translateY(-26px) rotate(0deg)`, offset: 0.52 },
      { transform: `translateX(${max * 0.68}px) translateY(-18px) rotate(14deg)`, offset: 0.62 },
      { transform: `translateX(${max * 0.86}px) translateY(0px) rotate(34deg)`, offset: 0.74 },
      { transform: `translateX(${max * 0.9}px) translateY(18px) rotate(20deg)`, offset: 0.84 },
      { transform: `translateX(${mid}px) translateY(18px) rotate(0deg)`, offset: 0.94 },
      { transform: `translateX(${mid}px) translateY(0px) rotate(0deg)`, offset: 1 },
    ], { duration: 1700, easing: 'linear' })
    breachAnim = anim
    clearTimeout(splashTimer1)
    clearTimeout(splashTimer2)
    splashTimer1 = setTimeout(() => spawnSplash(max * 0.14 + pet.offsetWidth / 2), 442)
    splashTimer2 = setTimeout(() => spawnSplash(max * 0.86 + pet.offsetWidth / 2), 1258)
    anim.finished.then(() => {
      if (breachAnim !== anim) return
      breachAnim = null
      breaching = false
      pet.classList.remove('breaching')
      pet.classList.add('floating')
      pet.style.transform = `translateX(${mid}px) translateY(0px) rotate(0deg)`
      if (running) breachTimer = setTimeout(() => breachOnce(), 1800 + Math.random() * 2600)
    }).catch(() => {})
  }

  function startBreachLoop() {
    if (breaching) return
    breachOnce()
  }

  function stopBreach() {
    running = false
    clearTimeout(breachTimer)
    breachTimer = null
    clearTimeout(splashTimer1)
    clearTimeout(splashTimer2)
    if (breachAnim !== null) { breachAnim.cancel(); breachAnim = null }
    breaching = false
    pet.classList.remove('breaching')
    setFloat()
    stopSpout()
  }

  function triggerSpout() {
    if (!spout) return
    spout.classList.remove('spouting')
    void spout.getBoundingClientRect()
    spout.classList.add('spouting')
    clearTimeout(spoutReset)
    spoutReset = setTimeout(() => spout.classList.remove('spouting'), 1400)
  }

  function scheduleSpout() {
    clearTimeout(spoutTimer)
    if (!running) return
    spoutTimer = setTimeout(() => {
      if (!running) return
      if (!breaching) triggerSpout()
      scheduleSpout()
    }, 4000 + Math.random() * 6000)
  }

  function stopSpout() {
    clearTimeout(spoutTimer)
    spoutTimer = null
    clearTimeout(spoutReset)
    spoutReset = null
    spout?.classList.remove('spouting')
  }

  async function pollActivity() {
    try {
      const response = await fetch('/quotapot/activity', {
        cache: 'no-store',
        headers: { accept: 'application/json', 'x-quotapot-token': token },
      })
      if (!response.ok) return
      const data = await response.json()
      const next = Boolean(data?.ok && Number(data.active) > 0)
      if (next === running) return
      running = next
      if (running) {
        startBreachLoop()
        scheduleSpout()
      } else {
        stopBreach()
      }
    } catch { /* keep the current pose */ }
  }

  let drag = null
  let moved = false

  function savePosition() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: host.style.left, top: host.style.top }))
    } catch { /* storage may be unavailable */ }
  }

  function restorePosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && saved.left && saved.top) {
        host.style.left = saved.left
        host.style.top = saved.top
        host.style.right = 'auto'
        host.style.bottom = 'auto'
        clampPosition()
      }
    } catch { /* ignore */ }
  }

  function clampPosition() {
    if (host.style.right !== 'auto') return
    const rect = host.getBoundingClientRect()
    const left = Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - rect.width - 4))
    const top = Math.min(Math.max(4, rect.top), Math.max(4, window.innerHeight - rect.height - 4))
    host.style.left = `${left}px`
    host.style.top = `${top}px`
  }

  pill.addEventListener('click', () => {
    if (moved) { moved = false; return }
    state.open = !state.open
    render()
    if (state.open) {
      if (state.tab === 'balance') loadBalance(false)
      else loadUsage(state.days, false)
    }
  })

  pill.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const rect = host.getBoundingClientRect()
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    moved = false
    pill.setPointerCapture(event.pointerId)
  })

  pill.addEventListener('pointermove', (event) => {
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
    if (!moved) return
    host.style.left = `${Math.max(4, Math.min(window.innerWidth - 60, drag.left + dx))}px`
    host.style.top = `${Math.max(4, Math.min(window.innerHeight - 40, drag.top + dy))}px`
    host.style.right = 'auto'
    host.style.bottom = 'auto'
  })

  pill.addEventListener('pointerup', () => {
    if (drag && moved) savePosition()
    drag = null
  })

  refresh.addEventListener('click', (event) => {
    event.stopPropagation()
    if (state.tab === 'usage') loadUsage(state.days, true)
    else if (state.tab === 'space') { state.cleanResult = ''; loadDisk(true) }
    else loadBalance(true)
  })

  updateBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    runUpdate()
  })

  scanBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    state.cleanResult = ''
    loadDisk(true)
  })

  cleanBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    cleanSelected()
  })

  thresholdInput.addEventListener('change', (event) => {
    event.stopPropagation()
    const value = Math.max(1, Number(thresholdInput.value) || 3)
    state.diskThreshold = value
    try { localStorage.setItem('quotapot.diskThresholdGB', String(value)) } catch { /* ignore */ }
    renderSpace()
  })

  tabs.forEach(tab => {
    tab.addEventListener('click', (event) => {
      event.stopPropagation()
      state.tab = tab.dataset.tab
      render()
      if (state.tab === 'usage') loadUsage(state.days, false)
      else if (state.tab === 'space' && state.disk === null && !state.diskLoading) loadDisk(false)
    })
  })

  ranges.forEach(range => {
    range.addEventListener('click', (event) => {
      event.stopPropagation()
      state.days = Number(range.dataset.days)
      render()
      loadUsage(state.days, true)
    })
  })

  pet.addEventListener('click', (event) => {
    event.stopPropagation()
    if (!breaching) breachOnce()
    triggerSpout()
  })

  pet.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (!breaching) breachOnce()
    triggerSpout()
  })

  todayLink.addEventListener('click', (event) => {
    event.stopPropagation()
    state.tab = 'usage'
    render()
    loadUsage(state.days, false)
  })

  document.addEventListener('pointerdown', (event) => {
    if (!state.open) return
    if (event.composedPath().includes(host)) return
    state.open = false
    render()
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      state.open = false
      render()
      pill.focus()
    }
  })

  window.addEventListener('resize', clampPosition)
  window.addEventListener('focus', () => {
    loadBalance(false)
    pollActivity()
    if (state.tab === 'usage' && state.open) loadUsage(state.days, false)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    loadBalance(false)
    pollActivity()
    if (state.tab === 'usage' && state.open) loadUsage(state.days, false)
  })

  restorePosition()
  render()
  loadBalance(false)
  checkUpdate()
  pollActivity()
  setInterval(pollActivity, 2_000)
  setInterval(() => {
    if (document.visibilityState !== 'visible') return
    loadBalance(false)
    if (state.tab === 'usage' && state.open) loadUsage(state.days, false)
  }, refreshSeconds * 1000)
  setInterval(() => checkUpdate(), 6 * 60 * 60_000)
})()

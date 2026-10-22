/* QuotaPot: a floating DeepSeek balance pill for DSH / DS Bot.
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
  const locale = config.locale === 'zh' || (config.locale === 'auto' && String(navigator.language || '').toLowerCase().startsWith('zh'))
    ? 'zh'
    : 'en'
  const zh = locale === 'zh'

  const text = {
    title: zh ? 'DEEPSEEK 余额' : 'DEEPSEEK BALANCE',
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
      .panel { pointer-events: auto; position: absolute; width: 224px; max-width: calc(100vw - 24px);
        padding: 12px 13px; border-radius: 13px; border: 1px solid rgba(120,120,128,.22);
        background: rgba(255,255,255,.97); color: #1c1c1e;
        box-shadow: 0 10px 30px rgba(0,0,0,.16); backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px); display: none; }
      .panel.open { display: block; }
      .panel[data-side="right"] { right: 0; } .panel[data-side="left"] { left: 0; }
      .panel[data-vertical="up"] { bottom: calc(100% + 8px); } .panel[data-vertical="down"] { top: calc(100% + 8px); }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .title { font-size: 11px; font-weight: 600; color: #6e6e73; letter-spacing: .3px; }
      .refresh { all: unset; cursor: pointer; color: #6e6e73; font-size: 14px; line-height: 1;
        padding: 2px 5px; border-radius: 6px; }
      .refresh:hover { background: rgba(120,120,128,.14); color: #1c1c1e; }
      .refresh:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 1px; }
      .refresh.spin { animation: spin .8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .refresh.spin { animation: none; } }
      .total { margin-top: 7px; font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
      .rows { margin-top: 6px; display: grid; gap: 3px; }
      .row { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: #6e6e73; font-variant-numeric: tabular-nums; }
      .row b { font-weight: 600; color: #1c1c1e; }
      .warn { margin-top: 7px; font-size: 11px; color: #b25000; }
      .error { margin-top: 6px; font-size: 11px; color: #ff453a; }
      .hint { margin-top: 3px; font-size: 10.5px; color: #8e8e93; line-height: 1.45; }
      .meta { margin-top: 7px; padding-top: 7px; border-top: 1px solid rgba(120,120,128,.16); font-size: 10.5px; color: #8e8e93; }
      @media (prefers-color-scheme: dark) {
        .pill { background: rgba(28,28,30,.84); color: #f2f2f7; border-color: rgba(255,255,255,.16); }
        .pill:hover { background: rgba(44,44,46,.96); }
        .panel { background: rgba(28,28,30,.97); color: #f2f2f7; border-color: rgba(255,255,255,.16); }
        .title, .row, .refresh { color: #aeaeb2; }
        .row b { color: #f2f2f7; }
        .refresh:hover { color: #f2f2f7; background: rgba(255,255,255,.10); }
        .meta { color: #8e8e93; border-top-color: rgba(255,255,255,.12); }
        .badge { color: #ffd60a; background: rgba(255,214,10,.16); }
        .warn { color: #ffd60a; }
      }
    </style>
    <div class="wrap">
      <button class="pill loading" type="button" aria-live="polite" aria-haspopup="dialog" aria-expanded="false">
        <span class="dot"></span><span class="amount">${text.loading}</span><span class="badge" hidden></span>
      </button>
      <div class="panel" role="dialog" aria-label="${text.title}" data-side="right" data-vertical="up">
        <div class="head"><span class="title">${text.title}</span><button class="refresh" type="button" title="${text.refresh}" aria-label="${text.refresh}">↻</button></div>
        <div class="total">--</div>
        <div class="rows"></div>
        <div class="warn" hidden></div>
        <div class="error" hidden></div>
        <div class="hint" hidden></div>
        <div class="meta">${text.loading}</div>
      </div>
    </div>
  `

  const pill = root.querySelector('.pill')
  const dot = root.querySelector('.dot')
  const amount = root.querySelector('.amount')
  const badge = root.querySelector('.badge')
  const panel = root.querySelector('.panel')
  const total = root.querySelector('.total')
  const rows = root.querySelector('.rows')
  const warn = root.querySelector('.warn')
  const error = root.querySelector('.error')
  const hint = root.querySelector('.hint')
  const meta = root.querySelector('.meta')
  const refresh = root.querySelector('.refresh')

  const panelSide = position.endsWith('left') ? 'left' : 'right'
  const panelVertical = position.startsWith('top') ? 'down' : 'up'
  panel.dataset.side = panelSide
  panel.dataset.vertical = panelVertical

  const state = { open: false, loading: false, data: null }

  const symbolOf = (currency) => ({ CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€', JPY: '¥' }[currency] || `${currency} `)
  const numberFormat = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const money = (value) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return String(value || '—')
    if (number > 0 && number < 0.01) return '<0.01'
    return numberFormat.format(number)
  }
  const primary = () => {
    const list = state.data?.balances ?? []
    return list.find(item => item.currency === 'CNY') || list[0] || null
  }
  const errorText = (code) => {
    if (code === 'NO_KEY') return { message: text.noKey, hint: zh ? '支持环境变量、DSH 凭据存储和 ~/.dsh/.credentials.yaml。' : 'Env var, DSH credential store, and ~/.dsh/.credentials.yaml are checked.' }
    if (code === 'AUTH') return { message: text.auth, hint: zh ? '在 设置 → 模型 中更新 DeepSeek API Key。' : 'Update the DeepSeek API key in Settings → Models.' }
    if (code === 'RATE_LIMIT') return { message: text.rate, hint: '' }
    if (code === 'NETWORK') return { message: text.network, hint: '' }
    if (code === 'UNAUTHORIZED') return { message: text.reload, hint: '' }
    return { message: code ? `HTTP ${String(code).replace(/^HTTP /, '')}` : text.network, hint: '' }
  }

  function render() {
    const data = state.data
    const item = primary()
    const ok = data?.ok === true
    const low = ok && item && Number(item.total) > 0 && Number(item.total) < threshold
    const insufficient = ok && item && (data.isAvailable === false || Number(item.total) <= 0)
    dot.className = 'dot' + (data && !ok ? ' err' : insufficient ? ' err' : low ? ' warn' : ok && data.isAvailable === false ? ' warn' : '')

    if (ok && item) {
      pill.classList.remove('loading')
      amount.textContent = `${symbolOf(item.currency)}${money(item.total)}`
      pill.title = `QuotaPot · ${item.currency} ${money(item.total)}`
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
      badge.hidden = !(low || insufficient)
      badge.textContent = insufficient ? '!' : (zh ? '低' : 'LOW')
      meta.textContent = `${text.updated} ${new Date(data.updatedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour12: false })}`
    } else if (data && !ok) {
      const info = errorText(data.error)
      pill.classList.remove('loading')
      amount.textContent = text.unavailable
      pill.title = `QuotaPot · ${info.message}`
      total.textContent = '--'
      rows.replaceChildren()
      warn.hidden = true
      error.hidden = false
      error.textContent = info.message
      hint.hidden = !info.hint
      hint.textContent = info.hint
      badge.hidden = true
      meta.textContent = info.message
    } else {
      pill.classList.add('loading')
      amount.textContent = text.loading
      total.textContent = '--'
      rows.replaceChildren()
      warn.hidden = true
      error.hidden = true
      hint.hidden = true
      badge.hidden = true
      meta.textContent = text.loading
    }

    panel.classList.toggle('open', state.open)
    pill.setAttribute('aria-expanded', String(state.open))
    refresh.classList.toggle('spin', state.loading)
  }

  async function load(force) {
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
    if (state.open) load(false)
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
    load(true)
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
  window.addEventListener('focus', () => load(false))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load(false)
  })

  restorePosition()
  render()
  load(false)
  setInterval(() => {
    if (document.visibilityState === 'visible') load(false)
  }, refreshSeconds * 1000)
})()

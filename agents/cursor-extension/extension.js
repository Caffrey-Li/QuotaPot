'use strict'

const vscode = require('vscode')
const core = require('./core.cjs')

let statusItem
let panel
let timer
let lastData = null
let refreshing = false

function settings() {
  const config = vscode.workspace.getConfiguration('quotapot')
  const number = (key, fallback) => {
    const value = Number(config.get(key, fallback))
    return Number.isFinite(value) ? value : fallback
  }
  return {
    deepseekBaseUrl: config.get('deepseekBaseUrl', 'https://api.deepseek.com'),
    cursorBaseUrl: config.get('cursorBaseUrl', 'https://api2.cursor.sh'),
    refreshSeconds: Math.max(30, number('refreshSeconds', 120)),
    statusBar: config.get('statusBar', 'all'),
    deepseekLowBalance: Math.max(0, number('deepseekLowBalance', 5)),
    cursorWarningPercent: Math.min(100, Math.max(0, number('cursorWarningPercent', 80))),
    codexWarningPercent: Math.min(100, Math.max(0, number('codexWarningPercent', 80))),
    dailyTokenLimit: Math.max(0, number('dailyTokenLimit', 0)),
  }
}

async function apiKey(context) {
  const stored = await context.secrets.get('quotapot.deepseekApiKey')
  return stored || process.env.DEEPSEEK_API_KEY || core.localConfig().deepseekApiKey || ''
}

function money(currency, value) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0)
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`
  }
}

function cursorPercent(cursor) {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(cursor.displayMessage || '')
  if (match) return Math.round(Number(match[1]))
  if (cursor.limitCents > 0) return Math.round(((cursor.limitCents - cursor.remainingCents) / cursor.limitCents) * 100)
  return 0
}

function statusText(data, warnings = {}) {
  const mode = settings().statusBar
  const parts = []
  if (mode === 'all' || mode === 'balance') {
    const balance = data.balance
    if (balance && balance.ok && Array.isArray(balance.balances) && balance.balances.length > 0) {
      const item = balance.balances.find(entry => entry.currency === 'CNY') || balance.balances[0]
      parts.push(money(item.currency, item.total))
    } else {
      parts.push('¥—')
    }
  }
  if (mode === 'all' || mode === 'cursor') {
    const cursor = data.cursor
    if (cursor && cursor.ok) {
      parts.push(`C ${cursorPercent(cursor)}%`)
    } else {
      parts.push('C !')
    }
  }
  if (mode === 'all' || mode === 'codex') {
    const codex = data.codex
    if (codex && codex.ok) {
      const used = codex.limit && codex.limit.primary ? Math.round(codex.limit.primary.used_percent) : 0
      parts.push(`X ${used}%`)
    } else {
      parts.push('X !')
    }
  }
  return `$(dashboard) QuotaPot ${parts.join(' · ')}${Object.values(warnings).some(Boolean) ? ' !' : ''}`
}

function tooltip(data) {
  const lines = ['**QuotaPot**', '']
  if (data.balance && data.balance.ok && data.balance.balances.length > 0) {
    for (const item of data.balance.balances) {
      lines.push(`DeepSeek ${item.currency}: **${money(item.currency, item.total)}** (topped up ${money(item.currency, item.toppedUp)}, granted ${money(item.currency, item.granted)})`)
    }
  } else {
    lines.push(`DeepSeek: ${data.balance?.error || 'not configured'} — run "QuotaPot: Set DeepSeek API Key"`)
  }
  if (data.cursor && data.cursor.ok) {
    lines.push('', `**Cursor** ${data.cursor.planName || ''}`)
    lines.push(`Used ${cursorPercent(data.cursor)}% · ${money('USD', data.cursor.remainingCents / 100)} left of ${money('USD', data.cursor.limitCents / 100)}`)
    if (data.cursor.displayMessage) lines.push(data.cursor.displayMessage)
    lines.push(`Auto ${Math.round(data.cursor.autoPercentUsed)}% · API ${Math.round(data.cursor.apiPercentUsed)}%`)
  } else {
    lines.push('', `Cursor: ${data.cursor?.error || 'unavailable'}`)
  }
  if (data.codex && data.codex.ok) {
    lines.push('', '**Codex (local sessions)**')
    lines.push(`Today ${core.formatTokens(data.codex.today)} · 7d ${core.formatTokens(data.codex.sevenDays)} · 30d ${core.formatTokens(data.codex.thirtyDays)} tokens`)
    if (data.codex.limit && data.codex.limit.primary) {
      lines.push(`5h window ${Math.round(data.codex.limit.primary.used_percent)}% used`)
    }
    if (data.codex.limit && data.codex.limit.secondary) {
      lines.push(`7d window ${Math.round(data.codex.limit.secondary.used_percent)}% used`)
    }
  } else {
    lines.push('', `Codex: ${data.codex?.error || 'unavailable'}`)
  }
  if (data.warnings && Object.values(data.warnings).some(Boolean)) {
    const reached = []
    if (data.warnings.balance) reached.push(`DeepSeek below ${settings().deepseekLowBalance}`)
    if (data.warnings.cursor) reached.push(`Cursor at/over ${settings().cursorWarningPercent}%`)
    if (data.warnings.codex) reached.push(`Codex at/over its threshold`)
    lines.push('', `⚠ ${reached.join(' · ')}`)
  }
  lines.push('', 'Click to open the side bar. Use **QuotaPot: Open in Editor** for a wide view.')
  return new vscode.MarkdownString(lines.join('\n'))
}

function setLoading() {
  if (!statusItem) return
  statusItem.text = '$(sync~spin) QuotaPot'
  statusItem.tooltip = 'Loading QuotaPot…'
}

async function refresh(context, { force = false } = {}) {
  if (refreshing) return lastData
  refreshing = true
  if (force) setLoading()
  try {
    const config = settings()
    const data = await core.status({
      apiKey: await apiKey(context),
      baseUrl: config.deepseekBaseUrl,
      cursorBaseUrl: config.cursorBaseUrl,
    })
    const cursorPct = data.cursor && data.cursor.ok ? cursorPercent(data.cursor) : 0
    const codexPct = Math.max(
      Number(data.codex && data.codex.limit && data.codex.limit.primary && data.codex.limit.primary.used_percent) || 0,
      Number(data.codex && data.codex.limit && data.codex.limit.secondary && data.codex.limit.secondary.used_percent) || 0,
    )
    data.warnings = {
      balance: config.deepseekLowBalance > 0 && Boolean(data.balance && data.balance.ok && data.balance.balances.some(item => item.total < config.deepseekLowBalance)),
      cursor: Boolean(data.cursor && data.cursor.ok && cursorPct >= config.cursorWarningPercent),
      codex: Boolean(data.codex && data.codex.ok && (codexPct >= config.codexWarningPercent || (config.dailyTokenLimit > 0 && data.codex.today >= config.dailyTokenLimit))),
    }
    data.config = {
      deepseekLowBalance: config.deepseekLowBalance,
      cursorWarningPercent: config.cursorWarningPercent,
      codexWarningPercent: config.codexWarningPercent,
      dailyTokenLimit: config.dailyTokenLimit,
    }
    lastData = data
    if (statusItem) {
      const warn = Object.values(data.warnings).some(Boolean)
      statusItem.text = statusText(data, data.warnings)
      statusItem.tooltip = tooltip(data)
      statusItem.color = warn ? new vscode.ThemeColor('statusBarItem.warningForeground') : undefined
      statusItem.backgroundColor = warn ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
    }
    postData(data)
    return data
  } catch (error) {
    if (statusItem) {
      statusItem.text = '$(warning) QuotaPot'
      statusItem.tooltip = String(error && error.message ? error.message : error)
    }
    return null
  } finally {
    refreshing = false
  }
}

function openDashboard() {
  vscode.env.openExternal(vscode.Uri.parse('https://cursor.com/dashboard?tab=usage'))
}

function openSettings() {
  vscode.commands.executeCommand('workbench.action.openSettings', '@ext:caffrey-li.quotapot')
}

function postData(data) {
  if (panel) panel.webview.postMessage({ type: 'data', data })
  if (viewProvider && viewProvider.view) viewProvider.view.webview.postMessage({ type: 'data', data })
}

function handleMessage(message, context) {
  if (!message) return
  if (message.type === 'refresh') refresh(context, { force: true })
  else if (message.type === 'dashboard') openDashboard()
  else if (message.type === 'settings') openSettings()
}

function panelHtml(sidebar = false) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 20px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  h1 { font-size: 18px; margin: 0; font-weight: 600; letter-spacing: .2px; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .sidebar .grid { grid-template-columns: 1fr; }
  .sidebar .sea { height: 112px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 12px; padding: 14px 16px; background: var(--vscode-sideBar-background); }
  .card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .8px; opacity: .65; margin: 0 0 10px; }
  .big { font-size: 24px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .big.warn { color: var(--vscode-errorForeground); }
  .muted { opacity: .65; font-size: 12px; line-height: 1.6; margin-top: 6px; }
  .warn { color: var(--vscode-errorForeground); font-size: 12px; line-height: 1.6; }
  .row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 3px 0; }
  .row span:last-child { font-variant-numeric: tabular-nums; opacity: .8; }

  .hero { margin: 2px 0 10px; }
  .sea { position: relative; height: 124px; width: 100%; overflow: hidden; }
  .stage { position: absolute; inset: 0; }
  .pet { position: absolute; left: 0; bottom: 0; width: 72px; height: 42px; z-index: 3;
    pointer-events: auto; cursor: pointer; transform-origin: 50% 50%; will-change: transform; }
  .pet:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 4px; border-radius: 12px; }
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
  @media (max-width: 480px) {
    body { padding: 12px; }
    .grid { grid-template-columns: 1fr; }
    .card { padding: 12px; }
    .big { font-size: 20px; }
    .sea { height: 112px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pet .whale, .wave, .pet .spout { animation: none !important; }
  }
  footer { margin-top: 16px; font-size: 11px; opacity: .55; line-height: 1.6; }
</style>
</head>
<body class="${sidebar ? 'sidebar' : ''}">
<div class="wrap">
  <header><h1>QuotaPot</h1><div class="actions"><button id="settings" class="secondary" title="Thresholds">⚙</button> <button id="refresh">Refresh</button> <button id="dashboard" class="secondary">Dashboard</button></div></header>
  <section class="hero" aria-label="QuotaPot whale">
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
        <div class="pet" role="button" tabindex="0" aria-label="QuotaPot whale; click to breach">
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
  </section>
  <div class="grid">
    <section class="card"><h2>DeepSeek balance</h2><div id="balance" class="big">—</div><div id="balance-meta" class="muted"></div></section>
    <section class="card"><h2>Cursor usage</h2><div id="cursor" class="big">—</div><div id="cursor-meta" class="muted"></div></section>
    <section class="card"><h2>Codex usage</h2><div id="codex" class="big">—</div><div id="codex-meta" class="muted"></div></section>
  </div>
  <footer id="footer">Reading DeepSeek balance, Cursor's dashboard API and local Codex sessions.</footer>
</div>
<script>
  const vscode = acquireVsCodeApi()
  const $ = id => document.getElementById(id)
  const money = (cents, currency = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100) } catch { return '$' + ((Number(cents) || 0) / 100).toFixed(2) } }
  const tokens = value => { const n = Number(value) || 0; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n) }
  const date = value => { if (!value) return '—'; const d = new Date(Number(value)); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—' }
  function render(data) {
    const balance = data.balance
    if (balance && balance.ok && balance.balances.length) {
      const item = balance.balances.find(entry => entry.currency === 'CNY') || balance.balances[0]
      $('balance').textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency, maximumFractionDigits: 2 }).format(item.total)
      $('balance-meta').textContent = 'Topped up ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency, maximumFractionDigits: 2 }).format(item.toppedUp) + ' · Granted ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency, maximumFractionDigits: 2 }).format(item.granted)
    } else {
      $('balance').textContent = '—'
      $('balance-meta').innerHTML = '<span class="warn">' + (balance && balance.error ? balance.error : 'Set a DeepSeek API key from the command palette.') + '</span>'
    }
    const cursor = data.cursor
    if (cursor && cursor.ok) {
      const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(cursor.displayMessage || '')
      const usedPercent = percentMatch ? Math.round(Number(percentMatch[1])) : Math.round(((cursor.limitCents - cursor.remainingCents) / Math.max(1, cursor.limitCents)) * 100)
      $('cursor').textContent = usedPercent + '% used'
      $('cursor-meta').innerHTML = (cursor.planName ? '<div class="row"><span>Plan</span><span>' + cursor.planName + '</span></div>' : '') +
        '<div class="row"><span>Remaining</span><span>' + money(cursor.remainingCents) + ' / ' + money(cursor.limitCents) + '</span></div>' +
        (cursor.displayMessage ? '<div class="muted">' + cursor.displayMessage + '</div>' : '') +
        '<div class="row"><span>Auto / API</span><span>' + Math.round(cursor.autoPercentUsed) + '% / ' + Math.round(cursor.apiPercentUsed) + '%</span></div>' +
        (cursor.onDemandRemainingCents !== null && cursor.onDemandRemainingCents !== undefined ? '<div class="row"><span>On-demand left</span><span>' + money(cursor.onDemandRemainingCents) + '</span></div>' : '') +
        (cursor.billingCycleEnd ? '<div class="row"><span>Cycle ends</span><span>' + date(cursor.billingCycleEnd) + '</span></div>' : '')
    } else {
      $('cursor').textContent = '—'
      $('cursor-meta').innerHTML = '<span class="warn">' + (cursor && cursor.error ? cursor.error : 'Cursor usage unavailable') + '</span>'
    }
    const codex = data.codex
    if (codex && codex.ok) {
      $('codex').textContent = tokens(codex.today) + ' today'
      $('codex-meta').innerHTML = '<div class="row"><span>7 days</span><span>' + tokens(codex.sevenDays) + '</span></div>' +
        '<div class="row"><span>30 days</span><span>' + tokens(codex.thirtyDays) + '</span></div>' +
        '<div class="row"><span>Sessions / calls</span><span>' + codex.sessions + ' / ' + codex.calls + '</span></div>' +
        (codex.limit && codex.limit.primary ? '<div class="row"><span>5h window</span><span>' + Math.round(codex.limit.primary.used_percent) + '% used · resets ' + date(codex.limit.primary.resets_at * 1000) + '</span></div>' : '') +
        (codex.limit && codex.limit.secondary ? '<div class="row"><span>7d window</span><span>' + Math.round(codex.limit.secondary.used_percent) + '% used · resets ' + date(codex.limit.secondary.resets_at * 1000) + '</span></div>' : '')
    } else {
      $('codex').textContent = '—'
      $('codex-meta').innerHTML = '<span class="warn">' + (codex && codex.error ? codex.error : 'No local Codex sessions') + '</span>'
    }
    $('balance').classList.toggle('warn', !!(data.warnings && data.warnings.balance))
    $('cursor').classList.toggle('warn', !!(data.warnings && data.warnings.cursor))
    $('codex').classList.toggle('warn', !!(data.warnings && data.warnings.codex))
    $('footer').textContent = 'Updated ' + new Date(data.updatedAt || Date.now()).toLocaleTimeString() + ' · Cursor usage uses an unofficial dashboard API · Codex numbers come from local session files.'
  }
  window.addEventListener('message', event => { if (event.data && event.data.type === 'data') render(event.data.data) })
  $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }))
  $('settings').addEventListener('click', () => vscode.postMessage({ type: 'settings' }))
  $('dashboard').addEventListener('click', () => vscode.postMessage({ type: 'dashboard' }))
  vscode.postMessage({ type: 'refresh' })

  ;(function whalePet() {
    const sea = document.querySelector('.sea')
    const pet = document.querySelector('.pet')
    const spout = document.querySelector('.spout')
    if (!sea || !pet) return
    let breaching = false
    let breachTimer = null
    let spoutTimer = null
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const maxX = () => Math.max(12, sea.clientWidth - pet.offsetWidth)
    const midX = () => maxX() / 2
    function setFloat() {
      pet.classList.remove('breaching')
      pet.classList.add('floating')
      pet.style.transform = 'translateX(' + midX() + 'px) translateY(0px) rotate(0deg)'
    }
    function spawnSplash(x) {
      const el = document.createElement('div')
      el.className = 'splash'
      el.style.left = x + 'px'
      const colors = ['#eaf5ff', '#ffffff', '#bcd8ff', '#9dc0ff']
      let html = '<span class="foam"></span><span class="ring"></span>'
      for (let i = 0; i < 12; i++) {
        const angle = -Math.PI * (0.12 + Math.random() * 0.76)
        const dist = 14 + Math.random() * 28
        const size = 3 + Math.random() * 3.5
        html += '<i style="--dx:' + (Math.cos(angle) * dist).toFixed(1) + 'px;--dy:' + (Math.sin(angle) * dist).toFixed(1) + 'px;width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;background:' + colors[i % colors.length] + '"></i>'
      }
      el.innerHTML = html
      sea.appendChild(el)
      requestAnimationFrame(() => el.classList.add('go'))
      setTimeout(() => el.remove(), 900)
    }
    function triggerSpout() {
      if (!spout) return
      spout.classList.remove('spouting')
      void spout.getBoundingClientRect()
      spout.classList.add('spouting')
      setTimeout(() => spout.classList.remove('spouting'), 1400)
    }
    function scheduleSpout() {
      clearTimeout(spoutTimer)
      spoutTimer = setTimeout(() => {
        if (!breaching && !document.hidden) triggerSpout()
        scheduleSpout()
      }, 4000 + Math.random() * 6000)
    }
    function breachOnce() {
      if (breaching || reduce) return
      breaching = true
      clearTimeout(breachTimer)
      breachTimer = null
      pet.classList.remove('floating')
      pet.classList.add('breaching')
      const max = maxX()
      const mid = max / 2
      const animation = pet.animate([
        { transform: 'translateX(' + mid + 'px) translateY(0px) rotate(0deg)', offset: 0 },
        { transform: 'translateX(' + mid + 'px) translateY(18px) rotate(0deg)', offset: 0.12 },
        { transform: 'translateX(' + (max * 0.14) + 'px) translateY(0px) rotate(-30deg)', offset: 0.26 },
        { transform: 'translateX(' + (max * 0.4) + 'px) translateY(-18px) rotate(-8deg)', offset: 0.42 },
        { transform: 'translateX(' + (max * 0.54) + 'px) translateY(-26px) rotate(0deg)', offset: 0.52 },
        { transform: 'translateX(' + (max * 0.68) + 'px) translateY(-18px) rotate(14deg)', offset: 0.62 },
        { transform: 'translateX(' + (max * 0.86) + 'px) translateY(0px) rotate(34deg)', offset: 0.74 },
        { transform: 'translateX(' + (max * 0.9) + 'px) translateY(18px) rotate(20deg)', offset: 0.84 },
        { transform: 'translateX(' + mid + 'px) translateY(18px) rotate(0deg)', offset: 0.94 },
        { transform: 'translateX(' + mid + 'px) translateY(0px) rotate(0deg)', offset: 1 },
      ], { duration: 1700, easing: 'linear' })
      setTimeout(() => spawnSplash(max * 0.14 + pet.offsetWidth / 2), 442)
      setTimeout(() => spawnSplash(max * 0.86 + pet.offsetWidth / 2), 1258)
      animation.finished.then(() => {
        breaching = false
        setFloat()
        if (!document.hidden && !reduce) breachTimer = setTimeout(breachOnce, 2200 + Math.random() * 2600)
      }).catch(() => {})
    }
    function toggle(event) {
      if (event) { event.stopPropagation(); event.preventDefault() }
      if (!breaching) breachOnce()
      triggerSpout()
    }
    pet.addEventListener('click', toggle)
    pet.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event)
    })
    window.addEventListener('resize', () => { if (!breaching) setFloat() })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(breachTimer)
        breachTimer = null
      } else if (!breaching && !reduce && !breachTimer) {
        breachTimer = setTimeout(breachOnce, 700)
      }
    })
    setFloat()
    scheduleSpout()
    if (!reduce) breachTimer = setTimeout(breachOnce, 900)
  })()
</script>
</body>
</html>`
}

function showPanel(context) {
  if (panel) { panel.reveal(); return }
  panel = vscode.window.createWebviewPanel('quotapot.panel', 'QuotaPot', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })
  panel.webview.html = panelHtml()
  panel.webview.onDidReceiveMessage(message => handleMessage(message, context), null, context.subscriptions)
  panel.onDidDispose(() => { panel = null })
  if (lastData) panel.webview.postMessage({ type: 'data', data: lastData })
  else refresh(context, { force: true })
}

async function setApiKey(context) {
  const value = await vscode.window.showInputBox({
    title: 'DeepSeek API key',
    prompt: 'Stored in Cursor SecretStorage, never in settings.json.',
    password: true,
    ignoreFocusOut: true,
  })
  if (value === undefined) return
  await context.secrets.store('quotapot.deepseekApiKey', value.trim())
  vscode.window.showInformationMessage('QuotaPot: DeepSeek API key saved.')
  refresh(context, { force: true })
}

class QuotaPotViewProvider {
  constructor(context) {
    this.context = context
    this.view = null
  }

  resolveWebviewView(view) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = panelHtml(true)
    view.webview.onDidReceiveMessage(message => handleMessage(message, this.context), null, this.context.subscriptions)
    view.onDidChangeVisibility(() => {
      if (view.visible) refresh(this.context)
    })
    if (lastData) view.webview.postMessage({ type: 'data', data: lastData })
    else refresh(this.context, { force: true })
  }
}

let viewProvider = null

function activate(context) {
  viewProvider = new QuotaPotViewProvider(context)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('quotapot.view', viewProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  }))
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusItem.command = 'quotapot.open'
  statusItem.text = '$(sync~spin) QuotaPot'
  statusItem.tooltip = 'Loading QuotaPot…'
  statusItem.show()
  context.subscriptions.push(statusItem)
  context.subscriptions.push(
    vscode.commands.registerCommand('quotapot.open', () => vscode.commands.executeCommand('quotapot.view.focus')),
    vscode.commands.registerCommand('quotapot.openEditor', () => showPanel(context)),
    vscode.commands.registerCommand('quotapot.openSettings', openSettings),
    vscode.commands.registerCommand('quotapot.refresh', () => refresh(context, { force: true })),
    vscode.commands.registerCommand('quotapot.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('quotapot.openCursorDashboard', openDashboard),
  )
  const config = settings()
  timer = setInterval(() => refresh(context), config.refreshSeconds * 1000)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('quotapot')) {
      clearInterval(timer)
      timer = setInterval(() => refresh(context), settings().refreshSeconds * 1000)
      refresh(context, { force: true })
    }
  }))
  refresh(context, { force: true })
}

function deactivate() {
  if (timer) clearInterval(timer)
  if (panel) panel.dispose()
}

module.exports = { activate, deactivate }

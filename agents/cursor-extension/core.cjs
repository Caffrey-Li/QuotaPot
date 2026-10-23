'use strict'

// Shared host-side core for the Cursor extension and the Codex MCP plugin.
// No DSH dependencies: it talks to DeepSeek, Cursor's local session and Codex's
// local session files, so both hosts can use the same numbers.
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 15_000
const GB = 1024 ** 3

function withTimeout() {
  return AbortSignal.timeout(TIMEOUT_MS)
}

function localConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quotapot', 'config.json'), 'utf8'))
  } catch {
    return {}
  }
}

function errorOf(error) {
  return String(error && error.message ? error.message : error).slice(0, 200)
}

async function deepseekBalance({ apiKey, baseUrl = 'https://api.deepseek.com' } = {}) {
  if (!apiKey) throw new Error('NO_DEEPSEEK_KEY')
  const url = `${String(baseUrl).replace(/\/+$/, '')}/user/balance`
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: withTimeout(),
  })
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`)
  const data = await response.json()
  const balances = (Array.isArray(data.balance_infos) ? data.balance_infos : []).map(item => ({
    currency: String(item.currency || 'CNY'),
    total: Number(item.total_balance) || 0,
    granted: Number(item.granted_balance) || 0,
    toppedUp: Number(item.topped_up_balance) || 0,
  }))
  return { ok: true, isAvailable: Boolean(data.is_available), balances }
}

function cursorDbPath() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
}

async function cursorToken() {
  const db = cursorDbPath()
  if (!fs.existsSync(db)) throw new Error('CURSOR_DB_NOT_FOUND')
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      db,
      "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';",
    ], { timeout: 10_000, maxBuffer: 1024 * 1024 })
    const token = String(stdout).trim()
    if (!token) throw new Error('CURSOR_TOKEN_NOT_FOUND')
    return token
  } catch (error) {
    if (error && error.message === 'CURSOR_TOKEN_NOT_FOUND') throw error
    throw new Error(`CURSOR_DB_READ_FAILED: ${errorOf(error)}`)
  }
}

async function cursorRpc(token, rpcPath, baseUrl = 'https://api2.cursor.sh') {
  const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}${rpcPath}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      'user-agent': 'quotapot-agents/0.1.0',
    },
    body: '{}',
    signal: withTimeout(),
  })
  if (response.status === 401 || response.status === 403) throw new Error('CURSOR_UNAUTHORIZED')
  if (!response.ok) throw new Error(`Cursor HTTP ${response.status}`)
  return response.json()
}

async function cursorUsage({ baseUrl = 'https://api2.cursor.sh' } = {}) {
  const token = await cursorToken()
  const [usageResult, planResult] = await Promise.allSettled([
    cursorRpc(token, '/aiserver.v1.DashboardService/GetCurrentPeriodUsage', baseUrl),
    cursorRpc(token, '/aiserver.v1.DashboardService/GetPlanInfo', baseUrl),
  ])
  if (usageResult.status === 'rejected') throw usageResult.reason
  const usage = usageResult.value
  const planUsage = usage && usage.planUsage
  if (!planUsage || planUsage.limit === undefined) throw new Error('CURSOR_USAGE_EMPTY')
  const limitCents = Number(planUsage.limit) || 0
  const usedCents = Number(planUsage.includedSpend) || 0
  const remainingCents = Number.isFinite(Number(planUsage.remaining))
    ? Number(planUsage.remaining)
    : Math.max(0, limitCents - usedCents)
  const usedPercent = Number.isFinite(Number(planUsage.totalPercentUsed))
    ? Number(planUsage.totalPercentUsed)
    : (limitCents > 0 ? ((limitCents - remainingCents) / limitCents) * 100 : 0)
  const planName = planResult.status === 'fulfilled'
    ? (planResult.value && planResult.value.planInfo && planResult.value.planInfo.planName) || null
    : null
  return {
    ok: true,
    planName,
    limitCents,
    usedCents,
    remainingCents,
    usedPercent,
    autoPercentUsed: Number(planUsage.autoPercentUsed) || 0,
    apiPercentUsed: Number(planUsage.apiPercentUsed) || 0,
    billingCycleEnd: Number(usage.billingCycleEnd) || null,
    displayMessage: usage.displayMessage || null,
    onDemandRemainingCents: Number.isFinite(Number(usage.spendLimitUsage && usage.spendLimitUsage.individualRemaining))
      ? Number(usage.spendLimitUsage.individualRemaining)
      : null,
  }
}

function dayKey(date) {
  const value = new Date(date)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayOffsetKey(offset) {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() - offset)
  return dayKey(value)
}

async function walkJsonl(dir, out = []) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walkJsonl(full, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

async function codexUsage() {
  const files = await walkJsonl(path.join(os.homedir(), '.codex', 'sessions'))
  const days = new Map()
  let total = 0
  let calls = 0
  let sessions = 0
  let latest = null
  let latestAt = 0
  for (const file of files) {
    let text
    try {
      text = await fsp.readFile(file, 'utf8')
    } catch {
      continue
    }
    let counted = false
    for (const line of text.split(/\r?\n/)) {
      if (!line || !line.includes('"token_count"')) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      const payload = event.payload
      if (!payload || payload.type !== 'token_count') continue
      const tokens = Number(payload.info && payload.info.last_token_usage && payload.info.last_token_usage.total_tokens) || 0
      const at = Date.parse(event.timestamp)
      if (!Number.isFinite(at)) continue
      calls += 1
      total += tokens
      const key = dayKey(at)
      days.set(key, (days.get(key) || 0) + tokens)
      if (payload.rate_limits && at >= latestAt) {
        latest = payload.rate_limits
        latestAt = at
      }
      counted = true
    }
    if (counted) sessions += 1
  }
  const today = days.get(dayOffsetKey(0)) || 0
  let sevenDays = 0
  let thirtyDays = 0
  for (let index = 0; index < 30; index++) {
    const tokens = days.get(dayOffsetKey(index)) || 0
    if (index < 7) sevenDays += tokens
    thirtyDays += tokens
  }
  return {
    ok: true,
    sessions,
    calls,
    total,
    today,
    sevenDays,
    thirtyDays,
    limit: latest === null ? null : {
      primary: latest.primary || null,
      secondary: latest.secondary || null,
      planType: latest.plan_type || null,
      credits: latest.credits || null,
    },
    updatedAt: latestAt || Date.now(),
  }
}

async function status(options = {}) {
  const [balance, cursor, codex] = await Promise.allSettled([
    deepseekBalance(options),
    cursorUsage({ baseUrl: options.cursorBaseUrl }),
    codexUsage(),
  ])
  const wrap = (result, label) => result.status === 'fulfilled'
    ? result.value
    : { ok: false, error: `${label}: ${errorOf(result.reason)}` }
  return {
    ok: true,
    balance: wrap(balance, 'DeepSeek'),
    cursor: wrap(cursor, 'Cursor'),
    codex: wrap(codex, 'Codex'),
    updatedAt: Date.now(),
  }
}

function formatTokens(value) {
  const number = Number(value) || 0
  if (number >= 1e9) return `${(number / 1e9).toFixed(2)}B`
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`
  if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`
  return String(number)
}

function formatMoney(cents, currency = 'USD') {
  const value = (Number(cents) || 0) / 100
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

module.exports = {
  GB,
  localConfig,
  codexUsage,
  cursorDbPath,
  cursorToken,
  cursorUsage,
  deepseekBalance,
  formatMoney,
  formatTokens,
  status,
}

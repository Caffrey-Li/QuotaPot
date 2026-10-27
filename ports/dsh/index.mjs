import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { degrade } from '../degrade.mjs'
import { renderPrompt } from '../prompts.mjs'
import { persistSnapshot, snapshot } from '../snapshot.mjs'
import { openRead } from '../sqlite.mjs'

const DAYS = [1, 7, 30]
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const API_TIMEOUT_MS = 15_000

export const id = 'dsh'
export const name = 'DS Bot'

// DS Bot keeps token usage and the DeepSeek balance locally, but no context window,
// so it has no chats section and no chat actions.
export const capabilities = {
  usage: true,
  chats: false,
  quota: true,
  modelStatus: false,
  actions: { open: false, paste: false, spawn: false },
}

export const promptProfile = {
  product: 'DS Bot',
  instructionsFile: 'AGENTS.md',
  compactCommand: '',
  hasContext: false,
  warnPercent: 80,
}

export function dshHome() {
  const configured = String(process.env.DSH_HOME || '').trim()
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.dsh')
}

function homeOf(target) {
  const home = os.homedir()
  const value = String(target || '')
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value
}

export function discoverAt(home = dshHome()) {
  try {
    if (fs.statSync(home).isDirectory()) return { ok: true, installed: true, home: homeOf(home) }
  } catch { /* missing */ }
  return { ...degrade('没有安装 DeepSeek Harness（' + homeOf(home) + ' 不存在）'), installed: false }
}

export function discover() {
  return discoverAt(dshHome())
}

export function usageDbPath(home = dshHome()) {
  return path.join(home, 'bot', 'usage.sqlite')
}

function startOfLocalDay(now = Date.now()) {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

export function sumTokens(row) {
  return (Number(row?.input) || 0) + (Number(row?.cacheRead) || 0)
    + (Number(row?.cacheWrite) || 0) + (Number(row?.output) || 0)
}

function ownerKind(key) {
  if (key.startsWith('room:')) return 'group'
  if (key.startsWith('agent:')) return 'agent'
  if (key === 'other') return 'other'
  return 'bot'
}

function readRows(file, since = 0) {
  let db
  try {
    db = openRead(file)
    const rows = db.prepare(`
      SELECT c.time AS time, c.session AS session, c.provider AS provider, c.model AS model,
             c.input AS input, c.cache_read AS cacheRead, c.cache_write AS cacheWrite,
             c.output AS output, COALESCE(o.owner, 'other') AS owner, COALESCE(o.name, '') AS name
      FROM calls c
      LEFT JOIN owners o ON o.session = c.session
      WHERE c.time >= ?
      ORDER BY c.time
    `).all(since)
    const count = db.prepare('SELECT count(*) AS n FROM calls').get()
    return { rows, totalCount: Number(count?.n) || 0 }
  } finally {
    try { db?.close() } catch { /* already closed */ }
  }
}

/** Aggregate call rows into totals, per-owner, per-model and per-session buckets. */
export function summarize(rows, { since = 0 } = {}) {
  const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, tokens: 0, calls: 0, first: Infinity, last: -Infinity }
  const owners = new Map()
  const models = new Map()
  const sessions = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    const time = Number(row?.time) || 0
    if (time < since) continue
    const input = Number(row?.input) || 0
    const cacheRead = Number(row?.cacheRead) || 0
    const cacheWrite = Number(row?.cacheWrite) || 0
    const output = Number(row?.output) || 0
    const tokens = input + cacheRead + cacheWrite + output

    totals.input += input
    totals.cacheRead += cacheRead
    totals.cacheWrite += cacheWrite
    totals.output += output
    totals.tokens += tokens
    totals.calls += 1
    totals.first = Math.min(totals.first, time)
    totals.last = Math.max(totals.last, time)

    const ownerKey = String(row?.owner || 'other')
    const owner = owners.get(ownerKey) || {
      key: ownerKey,
      name: String(row?.name || '').trim() || ownerKey,
      kind: ownerKind(ownerKey),
      tokens: 0, calls: 0, first: Infinity, last: -Infinity,
    }
    owner.name = String(row?.name || '').trim() || owner.name
    owner.tokens += tokens
    owner.calls += 1
    owner.first = Math.min(owner.first, time)
    owner.last = Math.max(owner.last, time)
    owners.set(ownerKey, owner)

    const modelName = String(row?.model || '未知模型')
    const model = models.get(modelName) || {
      model: modelName, provider: String(row?.provider || ''), tokens: 0, calls: 0,
      input: 0, cacheRead: 0, cacheWrite: 0, output: 0, lastAt: 0,
    }
    model.tokens += tokens
    model.calls += 1
    model.input += input
    model.cacheRead += cacheRead
    model.cacheWrite += cacheWrite
    model.output += output
    model.lastAt = Math.max(model.lastAt, time)
    models.set(modelName, model)

    const sessionId = String(row?.session || '')
    if (!sessionId) continue
    const session = sessions.get(sessionId) || {
      id: sessionId,
      name: String(row?.name || '').trim() || '未命名会话',
      owner: ownerKey,
      model: modelName,
      modelTokens: new Map(),
      tokens: 0,
      calls: 0,
      first: Infinity,
      last: -Infinity,
    }
    session.name = String(row?.name || '').trim() || session.name
    session.tokens += tokens
    session.calls += 1
    session.first = Math.min(session.first, time)
    session.last = Math.max(session.last, time)
    session.modelTokens.set(modelName, (session.modelTokens.get(modelName) || 0) + tokens)
    sessions.set(sessionId, session)
  }

  const ownerRows = [...owners.values()]
    .map((item) => ({
      ...item,
      first: Number.isFinite(item.first) ? item.first : null,
      last: Number.isFinite(item.last) ? item.last : null,
      spanMs: Number.isFinite(item.first) && item.last > item.first ? item.last - item.first : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const modelRows = [...models.values()].sort((a, b) => b.tokens - a.tokens)

  const sessionRows = [...sessions.values()]
    .map((item) => {
      const top = [...item.modelTokens.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        id: item.id,
        name: item.name,
        owner: item.owner,
        model: top ? top[0] : item.model,
        tokens: item.tokens,
        calls: item.calls,
        createdAt: Number.isFinite(item.first) ? item.first : null,
        updatedAt: Number.isFinite(item.last) ? item.last : null,
        spanMs: Number.isFinite(item.first) && item.last > item.first ? item.last - item.first : 0,
      }
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

  return {
    ...totals,
    first: Number.isFinite(totals.first) ? totals.first : null,
    last: Number.isFinite(totals.last) ? totals.last : null,
    owners: ownerRows,
    models: modelRows,
    sessions: sessionRows,
  }
}

export function usageFromDb(file, days = 1, now = Date.now(), onProgress = () => {}) {
  const span = DAYS.includes(Number(days)) ? Number(days) : 1
  const todayStart = startOfLocalDay(now)
  const since = todayStart - (span - 1) * 86_400_000
  if (!fs.existsSync(file)) return degrade('没有 DSH 用量数据库（~/.dsh/bot/usage.sqlite）')

  onProgress({ done: 0, total: 3, label: '用量', etaMs: 0 })
  let data
  try {
    data = readRows(file, since)
  } catch (error) {
    return degrade('读不到 DSH 用量数据库：' + String(error?.message || error).slice(0, 120))
  }
  onProgress({ done: 1, total: 3, label: '读取调用记录', etaMs: 0 })
  if (data.totalCount === 0) return degrade('DSH 还没有写入任何用量记录')

  const summary = summarize(data.rows, { since })
  onProgress({ done: 2, total: 3, label: '汇总', etaMs: 0 })
  onProgress({ done: 3, total: 3, label: '完成', etaMs: 0 })
  return {
    ok: true,
    source: 'dsh',
    unit: 'token',
    days: span,
    since,
    todayStart,
    tokens: summary.tokens,
    calls: summary.calls,
    input: summary.input,
    cacheRead: summary.cacheRead,
    cacheWrite: summary.cacheWrite,
    output: summary.output,
    models: summary.models,
    owners: summary.owners,
    sessions: summary.sessions,
    truncated: false,
    updatedAt: now,
  }
}

export async function usage(days = 1, onProgress = () => {}) {
  const found = discover()
  if (!found.installed) return found
  const span = DAYS.includes(Number(days)) ? Number(days) : 1
  const result = usageFromDb(usageDbPath(), span, Date.now(), onProgress)
  if (result.ok) {
    try {
      const store = snapshot()
      store.dsh = store.dsh || {}
      store.dsh.usage = store.dsh.usage || {}
      store.dsh.usage[String(span)] = result
      persistSnapshot()
    } catch { /* a snapshot failure must not hide real usage */ }
  }
  return result
}

export function peekUsage(days) {
  const span = DAYS.includes(Number(days)) ? Number(days) : 1
  return snapshot().dsh?.usage?.[String(span)] || null
}

export function prompts(kind, chat) {
  const allowed = ['new', 'handoff', 'inherit', 'crash']
  if (!allowed.includes(kind)) return degrade('没有这种提示词')
  return { ok: true, kind, text: renderPrompt(promptProfile, kind, chat || null) }
}

export function parseCredentialRefs(text, name) {
  let inRefs = false
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
    if (!inRefs) continue
    if (/^\S/.test(line)) break
    const match = /^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(line)
    if (match && match[1] === name) {
      const value = match[2]
      const unquoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value
      return unquoted || null
    }
  }
  return null
}

function readKeyFromFile() {
  try {
    return parseCredentialRefs(fs.readFileSync(path.join(dshHome(), '.credentials.yaml'), 'utf8'), 'DEEPSEEK_API_KEY')
  } catch {
    return null
  }
}

export function resolveApiKey() {
  const fromEnv = String(process.env.DEEPSEEK_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  const ref = readKeyFromFile()
  if (!ref) return ''
  if (/^(keychain|secret|op|vault):/i.test(ref)) return ''
  return String(ref).trim()
}

export function normalizeBalance(payload, now = Date.now()) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const balances = infos.map((info) => ({
    currency: String(info?.currency || 'CNY').toUpperCase(),
    total: Number(info?.total_balance),
    toppedUp: Number(info?.topped_up_balance ?? info?.top_up_balance),
    granted: Number(info?.granted_balance),
  })).filter((item) => Number.isFinite(item.total))
  if (balances.length === 0) return degrade('DeepSeek 余额响应里没有金额')
  return {
    ok: true,
    isAvailable: payload?.is_available !== false,
    balances,
    updatedAt: now,
  }
}

export function balanceMenu(data) {
  if (!data?.ok) return data || degrade('没有余额数据')
  const balance = data.balances.find((item) => item.currency === 'CNY') || data.balances[0]
  if (!balance || !Number.isFinite(balance.total)) return degrade('DeepSeek 余额响应里没有金额')
  const symbol = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥' }[balance.currency] || ''
  const display = '余额 ' + symbol + balance.total.toFixed(2) + (symbol ? '' : ' ' + balance.currency)
  return {
    ok: true,
    unit: 'currency',
    currency: balance.currency,
    amount: balance.total,
    balance: balance.total,
    display,
    isAvailable: data.isAvailable,
    balances: data.balances,
    updatedAt: data.updatedAt,
  }
}

function deepSeekBase() {
  const raw = String(process.env.DEEPSEEK_BASE_URL || '').trim()
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : DEFAULT_BASE_URL
}

export async function menu() {
  const key = resolveApiKey()
  if (!key) return degrade('没有找到 DeepSeek API Key，余额不可用')
  let response
  try {
    response = await fetch(deepSeekBase() + '/user/balance', {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (error) {
    return degrade('读取 DeepSeek 余额失败：' + String(error?.message || error).slice(0, 80))
  }
  if (response.status === 401 || response.status === 403) return degrade('DeepSeek API Key 无效或已过期')
  if (response.status === 429) return degrade('DeepSeek 余额查询被限流，稍后再试')
  if (!response.ok) return degrade('DeepSeek 余额接口返回 HTTP ' + response.status)
  let payload
  try {
    payload = await response.json()
  } catch {
    return degrade('DeepSeek 余额响应不是 JSON')
  }
  return balanceMenu(normalizeBalance(payload))
}

// QuotaPot: a floating DeepSeek API balance pill for DSH / DS Bot.
//
// Host half: reads the API key through DSH's credential service (env and the
// local credential file are fallbacks), caches the balance briefly, and serves
// it to the page over a token-protected same-origin route. The key never leaves
// this process.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-bot-quotapot'
export const inject = ['webServer']

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const VERSION = PKG.version
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CACHE_MS = 15_000
const ERROR_CACHE_MS = 5_000
const USAGE_CACHE_MS = 20_000
const USAGE_DAYS = [1, 7, 30]
const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left']

let credentialRefFn
let pending = null
let cache = { at: 0, keyId: '', data: null }
const ACTIVE_TTL_MS = 2 * 60 * 60_000
const activeTurns = new Map()

const clampInt = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Config accepted from cordis.patch.yml; every field is optional. */
export function normalizeConfig(raw = {}) {
  const base = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
  const baseUrl = /^https?:\/\/[^\s]+$/i.test(base) ? base.replace(/\/+$/, '') : 'https://api.deepseek.com'
  const apiKeyEnv = typeof raw.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.apiKeyEnv)
    ? raw.apiKeyEnv
    : 'DEEPSEEK_API_KEY'
  const threshold = Number(raw.lowBalanceThreshold)
  const daily = Number(raw.dailyTokenLimit)
  return {
    apiKeyEnv,
    baseUrl,
    refreshSeconds: clampInt(raw.refreshSeconds, 10, 600, 30),
    lowBalanceThreshold: Number.isFinite(threshold) ? Math.max(0, threshold) : 5,
    dailyTokenLimit: Number.isFinite(daily) ? Math.max(0, Math.round(daily)) : 0,
    position: POSITIONS.includes(raw.position) ? raw.position : 'bottom-right',
    locale: ['auto', 'zh', 'en'].includes(raw.locale) ? raw.locale : 'auto',
  }
}

/** Parse `refs:` entries out of a DSH credential file. */
export function parseCredentialRefs(text, name) {
  let inRefs = false
  for (const line of String(text).split(/\r?\n/)) {
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

/** Normalize the official /user/balance payload for the widget. */
export function normalizeBalance(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  return {
    ok: true,
    isAvailable: payload?.is_available !== false,
    balances: infos.map(info => ({
      currency: String(info?.currency ?? 'CNY'),
      total: String(info?.total_balance ?? ''),
      toppedUp: String(info?.topped_up_balance ?? info?.top_up_balance ?? ''),
      granted: String(info?.granted_balance ?? ''),
    })),
    updatedAt: Date.now(),
  }
}


let DatabaseSyncCtor
let usageCache = new Map()

/** Local midnight for the day containing `now`. */
export function startOfLocalDay(now = Date.now()) {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** Billable tokens in one ledger row (input + cache + output). */
export function sumTokens(row) {
  return (Number(row?.input) || 0) + (Number(row?.cacheRead) || 0)
    + (Number(row?.cacheWrite) || 0) + (Number(row?.output) || 0)
}

const ownerKind = (key) => {
  if (key.startsWith('room:')) return 'group'
  if (key.startsWith('agent:')) return 'agent'
  if (key === 'other') return 'other'
  return 'bot'
}

/**
 * Sum flat call rows per owner and overall. `spanMs` is the wall-clock span
 * between the owner's first and last call in the range (session span).
 */
export function aggregateUsage(rows, { since = 0 } = {}) {
  const owners = new Map()
  let first = Infinity
  let last = -Infinity
  for (const row of rows) {
    const time = Number(row?.time) || 0
    if (time < since) continue
    const key = String(row?.owner || 'other')
    const entry = owners.get(key) ?? {
      key,
      name: String(row?.name || '').trim() || key,
      kind: ownerKind(key),
      tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0,
      first: Infinity, last: -Infinity,
    }
    entry.input += Number(row?.input) || 0
    entry.cacheRead += Number(row?.cacheRead) || 0
    entry.cacheWrite += Number(row?.cacheWrite) || 0
    entry.output += Number(row?.output) || 0
    entry.tokens += sumTokens(row)
    entry.calls += 1
    entry.first = Math.min(entry.first, time)
    entry.last = Math.max(entry.last, time)
    owners.set(key, entry)
    first = Math.min(first, time)
    last = Math.max(last, time)
  }
  const list = [...owners.values()]
    .map(owner => ({
      ...owner,
      first: Number.isFinite(owner.first) ? owner.first : null,
      last: Number.isFinite(owner.last) ? owner.last : null,
      spanMs: Number.isFinite(owner.first) && owner.last > owner.first ? owner.last - owner.first : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
  const total = list.reduce((acc, owner) => {
    acc.tokens += owner.tokens
    acc.input += owner.input
    acc.cacheRead += owner.cacheRead
    acc.cacheWrite += owner.cacheWrite
    acc.output += owner.output
    acc.calls += owner.calls
    return acc
  }, { tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 })
  total.first = Number.isFinite(first) ? first : null
  total.last = Number.isFinite(last) ? last : null
  total.spanMs = Number.isFinite(first) && last > first ? last - first : 0
  total.spanSumMs = list.reduce((acc, owner) => acc + owner.spanMs, 0)
  return { owners: list, totals: total }
}

async function openUsageDb() {
  if (DatabaseSyncCtor === undefined) {
    try {
      ({ DatabaseSync: DatabaseSyncCtor } = await import('node:sqlite'))
    } catch {
      DatabaseSyncCtor = null
    }
  }
  if (!DatabaseSyncCtor) return null
  return new DatabaseSyncCtor(join(DSH_HOME, 'bot', 'usage.sqlite'), { readOnly: true })
}

/** Token usage from DS Bot's usage ledger, grouped per Bot and over `days`. */
export async function readUsage(days = 1, { fresh = false } = {}) {
  const span = USAGE_DAYS.includes(Number(days)) ? Number(days) : 1
  const now = Date.now()
  const todayStart = startOfLocalDay(now)
  const since = todayStart - (span - 1) * 86_400_000
  const key = `${span}:${todayStart}`
  const hit = usageCache.get(key)
  if (!fresh && hit && now - hit.at < USAGE_CACHE_MS) return hit.data

  let db
  try {
    db = await openUsageDb()
    if (db === null) return { ok: false, error: 'NO_SQLITE', updatedAt: Date.now() }
    const rows = db.prepare(`
      SELECT c.time AS time, c.input AS input, c.cache_read AS cacheRead,
             c.cache_write AS cacheWrite, c.output AS output,
             COALESCE(o.owner, 'other') AS owner, COALESCE(o.name, '') AS name
      FROM calls c
      LEFT JOIN owners o ON o.session = c.session
      WHERE c.time >= ?
    `).all(since)
    const all = aggregateUsage(rows, { since })
    const today = aggregateUsage(rows, { since: todayStart })
    const data = {
      ok: true,
      days: span,
      since,
      todayStart,
      owners: all.owners,
      totals: all.totals,
      today: today.totals,
      updatedAt: Date.now(),
    }
    usageCache.set(key, { at: Date.now(), data })
    if (usageCache.size > 20) usageCache = new Map([...usageCache].slice(-10))
    return data
  } catch (error) {
    return { ok: false, error: 'NO_USAGE', detail: String(error?.message ?? error).slice(0, 160), updatedAt: Date.now() }
  } finally {
    try { db?.close() } catch { /* already closed */ }
  }
}

/** Attach the configured daily limit and whether it is exceeded. */
export function withDailyLimit(usage, limit) {
  if (!usage?.ok) return usage
  const tokens = usage.today?.tokens ?? 0
  return {
    ...usage,
    daily: { tokens, limit, exceeded: limit > 0 && tokens >= limit },
  }
}

/** Constant-time check for the per-process page token. */
export function tokenMatches(expected, received) {
  const a = Buffer.from(String(expected ?? ''))
  const b = Buffer.from(String(received ?? ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

async function credentialRef(name) {
  if (credentialRefFn === undefined) {
    try {
      credentialRefFn = (await import('@deepseek-ai/dsh-credentials')).credentialRef
    } catch {
      credentialRefFn = null
    }
  }
  return credentialRefFn ? credentialRefFn(name) : null
}

async function readKeyFromFile(name) {
  try {
    const text = await readFile(join(DSH_HOME, '.credentials.yaml'), 'utf8')
    return parseCredentialRefs(text, name)
  } catch {
    return null
  }
}

async function resolveApiKey(ctx, config) {
  const fromEnv = process.env[config.apiKeyEnv]
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()

  const service = ctx.get?.('credentials')
  if (service?.resolve) {
    const ref = await credentialRef(config.apiKeyEnv)
    if (ref) {
      try {
        const hit = await service.resolve(ref)
        if (hit?.value) return String(hit.value).trim()
      } catch { /* fall through to the file */ }
    }
  }
  return readKeyFromFile(config.apiKeyEnv)
}

async function fetchBalance(ctx, config) {
  const key = await resolveApiKey(ctx, config)
  if (!key) return { ok: false, error: 'NO_KEY', updatedAt: Date.now() }
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16)

  if (cache.data !== null && cache.keyId === keyId) {
    const ttl = cache.data.ok ? CACHE_MS : ERROR_CACHE_MS
    if (Date.now() - cache.at < ttl) return cache.data
  }
  if (pending !== null) return pending

  pending = (async () => {
    try {
      const response = await fetch(`${config.baseUrl}/user/balance`, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'AUTH', updatedAt: Date.now() }
      }
      if (response.status === 429) {
        return { ok: false, error: 'RATE_LIMIT', updatedAt: Date.now() }
      }
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}`, updatedAt: Date.now() }
      }
      return normalizeBalance(await response.json())
    } catch (error) {
      const detail = String(error?.message ?? error)
      return { ok: false, error: 'NETWORK', detail: detail.slice(0, 160), updatedAt: Date.now() }
    }
  })().finally(() => { pending = null })

  const data = await pending
  cache = { at: Date.now(), keyId, data }
  return data
}

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  })
  res.end(JSON.stringify(body))
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const token = randomUUID()
  const widgetSource = readFileSync(new URL('./widget.js', import.meta.url), 'utf8')
  const publicConfig = {
    refreshSeconds: config.refreshSeconds,
    lowBalanceThreshold: config.lowBalanceThreshold,
    dailyTokenLimit: config.dailyTokenLimit,
    position: config.position,
    locale: config.locale,
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    const id = session?.id
    if (typeof id !== 'string' || id === '') return
    const type = event?.type
    if (type === 'turn/start') {
      activeTurns.set(id, { at: Date.now(), turn: event?.data?.turn })
    } else if (type === 'turn/end') {
      activeTurns.delete(id)
    } else if (activeTurns.has(id)) {
      activeTurns.set(id, { ...activeTurns.get(id), at: Date.now() })
    }
  }), 'quotapot: turn activity')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/balance',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' })
        return
      }
      if (!tokenMatches(token, req.headers['x-quotapot-token'])) {
        sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const balance = await fetchBalance(ctx, config)
      const usage = withDailyLimit(await readUsage(1), config.dailyTokenLimit)
      sendJson(res, 200, {
        ...balance,
        usage: usage.ok
          ? { todayTokens: usage.daily.tokens, limit: usage.daily.limit, exceeded: usage.daily.exceeded }
          : { error: usage.error },
      })
    },
  }), 'quotapot: balance route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/activity',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' })
        return
      }
      if (!tokenMatches(token, req.headers['x-quotapot-token'])) {
        sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const now = Date.now()
      for (const [id, entry] of activeTurns) {
        if (now - entry.at > ACTIVE_TTL_MS) activeTurns.delete(id)
      }
      sendJson(res, 200, { ok: true, active: activeTurns.size, at: now })
    },
  }), 'quotapot: activity route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/usage',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' })
        return
      }
      if (!tokenMatches(token, req.headers['x-quotapot-token'])) {
        sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const requested = Number(url.searchParams.get('days'))
      const days = USAGE_DAYS.includes(requested) ? requested : 1
      const usage = withDailyLimit(await readUsage(days, { fresh: url.searchParams.has('fresh') }), config.dailyTokenLimit)
      sendJson(res, 200, usage)
    },
  }), 'quotapot: usage route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/widget.js',
    handler: (req, res) => {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end(widgetSource)
    },
  }), 'quotapot: widget asset')

  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: '__QUOTAPOT__',
      value: { token, version: VERSION, config: publicConfig },
    })
    table.push({
      kind: 'script-src',
      src: `/quotapot/widget.js?v=${VERSION}`,
      placement: 'body',
    })
  }), 'quotapot: index injection')
}

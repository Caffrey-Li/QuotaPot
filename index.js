// QuotaPot: a floating DeepSeek API balance pill for DSH / DS Bot.
//
// Host half: reads the API key through DSH's credential service (env and the
// local credential file are fallbacks), caches the balance briefly, and serves
// it to the page over a token-protected same-origin route. The key never leaves
// this process.
import { execFile } from 'node:child_process'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm, stat, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

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
const REPO = 'Caffrey-Li/dsh-bot-QuotaPot'
const UPDATE_TTL_MS = 6 * 60 * 60_000
const UPDATE_TIMEOUT_MS = 15_000
const DISK_CACHE_MS = 60_000
const DEFAULT_DISK_GB = 3
const AGENTS_CACHE_MS = 60_000
const WORKBUDDY_DB = join(homedir(), '.workbuddy', 'workbuddy.db')
const ZCODE_PLAN = join(homedir(), '.zcode', 'v2', 'coding-plan-cache.json')
const execFileAsync = promisify(execFile)

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
  const disk = Number(raw.diskThresholdGB)
  return {
    apiKeyEnv,
    baseUrl,
    refreshSeconds: clampInt(raw.refreshSeconds, 10, 600, 30),
    lowBalanceThreshold: Number.isFinite(threshold) ? Math.max(0, threshold) : 5,
    dailyTokenLimit: Number.isFinite(daily) ? Math.max(0, Math.round(daily)) : 0,
    diskThresholdGB: Number.isFinite(disk) && disk > 0 ? disk : DEFAULT_DISK_GB,
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

async function sqliteCtor() {
  if (DatabaseSyncCtor === undefined) {
    try {
      ({ DatabaseSync: DatabaseSyncCtor } = await import('node:sqlite'))
    } catch {
      DatabaseSyncCtor = null
    }
  }
  return DatabaseSyncCtor
}

async function openSqlite(path) {
  const Ctor = await sqliteCtor()
  if (!Ctor) return null
  try {
    return new Ctor(path, { readOnly: true })
  } catch {
    return null
  }
}

async function openUsageDb() {
  return openSqlite(join(DSH_HOME, 'bot', 'usage.sqlite'))
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


/** Semver comparison for the release tag; prereleases compare by their numeric core. */
export function newerVersion(a, b) {
  const parse = value => String(value ?? '').trim().replace(/^v/i, '').split('-')[0]
    .split('.').map(part => Number.parseInt(part, 10) || 0)
  const x = parse(a)
  const y = parse(b)
  for (let index = 0; index < 3; index++) {
    if (x[index] !== y[index]) return x[index] > y[index]
  }
  return false
}

let updateCache = { at: 0, data: null }
let installingUpdate = null

async function fetchLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `dsh-bot-quotapot/${VERSION}` },
    signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return response.json()
}

/** Latest GitHub release compared with this build. Cached for six hours. */
export async function checkUpdate({ fresh = false } = {}) {
  if (!fresh && updateCache.data !== null && Date.now() - updateCache.at < UPDATE_TTL_MS) return updateCache.data
  try {
    const release = await fetchLatestRelease()
    const latest = String(release?.tag_name ?? '').replace(/^v/i, '')
    const data = {
      current: VERSION,
      latest: latest || null,
      available: latest !== '' && newerVersion(latest, VERSION),
      url: release?.html_url ?? null,
      notes: String(release?.body ?? '').slice(0, 700),
      publishedAt: release?.published_at ?? null,
      checkedAt: Date.now(),
    }
    updateCache = { at: Date.now(), data }
    return data
  } catch (error) {
    return {
      current: VERSION,
      latest: null,
      available: false,
      error: String(error?.message ?? error).slice(0, 180),
      checkedAt: Date.now(),
    }
  }
}

/** Install the latest release through DSH's plugin manager; it runs after a restart. */
export async function installUpdate(ctx) {
  if (installingUpdate !== null) return installingUpdate
  installingUpdate = (async () => {
    const info = await checkUpdate({ fresh: true })
    if (!info.latest) return { ok: false, error: info.error ?? 'NO_RELEASE' }
    if (!info.available) return { ok: false, error: 'NO_UPDATE', latest: info.latest }
    const manager = ctx.get?.('pluginManager')
    if (typeof manager?.installBundle !== 'function') return { ok: false, error: 'NO_PLUGIN_MANAGER' }
    try {
      const result = await manager.installBundle(`github:${REPO}#v${info.latest}`, {})
      if (result?.error || !['applied', 'restart-required'].includes(result?.application)) {
        return { ok: false, error: String(result?.error?.diagnostic ?? result?.error?.code ?? `install ${result?.application ?? 'failed'}`).slice(0, 300) }
      }
      updateCache = { at: 0, data: null }
      return { ok: true, version: info.latest, restartRequired: true }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 300) }
    }
  })().finally(() => { installingUpdate = null })
  return installingUpdate
}

const PLATFORM = process.platform
const APP_SUPPORT = PLATFORM === 'darwin'
  ? join(homedir(), 'Library', 'Application Support')
  : PLATFORM === 'win32'
    ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
    : join(homedir(), '.config')
const CACHE_DIR = PLATFORM === 'darwin'
  ? join(homedir(), 'Library', 'Caches')
  : PLATFORM === 'win32'
    ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : join(homedir(), '.cache')

/** Known AI tool directories. Only entries marked safe may ever be deleted. */
export function diskTargets() {
  const pnpmStore = PLATFORM === 'darwin'
    ? join(homedir(), 'Library', 'pnpm', 'store')
    : PLATFORM === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'pnpm', 'store')
      : join(homedir(), '.local', 'share', 'pnpm', 'store')
  return [
    { id: 'dsh', label: 'DSH / DS Bot data', path: DSH_HOME, safe: false, hint: 'sessions, bot data, workspace' },
    { id: 'playwright', label: 'Playwright browsers', path: join(CACHE_DIR, 'ms-playwright'), safe: true, hint: 're-downloaded when needed' },
    { id: 'cursor', label: 'Cursor', path: join(APP_SUPPORT, 'Cursor'), safe: false, hint: 'chats, settings, snapshots' },
    { id: 'cursor-cacheddata', label: 'Cursor CachedData', path: join(APP_SUPPORT, 'Cursor', 'CachedData'), safe: true },
    { id: 'cursor-cache', label: 'Cursor Cache', path: join(APP_SUPPORT, 'Cursor', 'Cache'), safe: true },
    { id: 'cursor-codecache', label: 'Cursor Code Cache', path: join(APP_SUPPORT, 'Cursor', 'Code Cache'), safe: true },
    { id: 'cursor-gpucache', label: 'Cursor GPUCache', path: join(APP_SUPPORT, 'Cursor', 'GPUCache'), safe: true },
    { id: 'cursor-logs', label: 'Cursor logs', path: join(APP_SUPPORT, 'Cursor', 'logs'), safe: true },
    { id: 'npm', label: 'npm cache', path: join(homedir(), '.npm', '_cacache'), safe: true },
    { id: 'pnpm', label: 'pnpm store', path: pnpmStore, safe: true, hint: 'rebuilt on demand' },
    { id: 'hf', label: 'HuggingFace cache', path: join(homedir(), '.cache', 'huggingface'), safe: true, hint: 'models re-download' },
    { id: 'ollama', label: 'Ollama models', path: join(homedir(), '.ollama'), safe: false, hint: 'models must be pulled again' },
    { id: 'chatgpt', label: 'ChatGPT data', path: join(APP_SUPPORT, 'ChatGPT'), safe: false },
    { id: 'codex', label: 'Codex data', path: join(homedir(), '.codex'), safe: false },
    { id: 'workbuddy', label: 'WorkBuddy', path: join(homedir(), '.workbuddy'), safe: false, hint: 'sessions, workspaces, credits db' },
    { id: 'workbuddy-gpu', label: 'WorkBuddy GPUCache', path: join(APP_SUPPORT, 'WorkBuddy', 'GPUCache'), safe: true },
    { id: 'workbuddy-dawn', label: 'WorkBuddy DawnGraphiteCache', path: join(APP_SUPPORT, 'WorkBuddy', 'DawnGraphiteCache'), safe: true },
    { id: 'workbuddy-cache', label: 'WorkBuddy Cache', path: join(APP_SUPPORT, 'WorkBuddy', 'Cache'), safe: true },
    { id: 'workbuddy-codecache', label: 'WorkBuddy Code Cache', path: join(APP_SUPPORT, 'WorkBuddy', 'Code Cache'), safe: true },
    { id: 'zcode', label: 'ZCode', path: join(homedir(), '.zcode'), safe: false, hint: 'tasks, plan, credentials' },
    { id: 'zcode-gpu', label: 'ZCode GPUCache', path: join(APP_SUPPORT, 'ZCode', 'GPUCache'), safe: true },
    { id: 'zcode-cache', label: 'ZCode Cache', path: join(APP_SUPPORT, 'ZCode', 'Cache'), safe: true },
    { id: 'claude-home', label: 'Claude home', path: join(homedir(), '.claude'), safe: false, hint: 'Claude Code skills/sessions' },
    { id: 'claude', label: 'Claude desktop', path: join(APP_SUPPORT, 'Claude'), safe: false, hint: 'desktop data; no local token usage' },
    { id: 'claude-gpu', label: 'Claude GPUCache', path: join(APP_SUPPORT, 'Claude', 'GPUCache'), safe: true },
    { id: 'claude-dawn', label: 'Claude DawnGraphiteCache', path: join(APP_SUPPORT, 'Claude', 'DawnGraphiteCache'), safe: true },
    { id: 'claude-cache', label: 'Claude Cache', path: join(APP_SUPPORT, 'Claude', 'Cache'), safe: true },
    { id: 'trae', label: 'Trae', path: join(APP_SUPPORT, 'Trae'), safe: false, hint: 'Trae editor data' },
    { id: 'trae-solo', label: 'Trae Solo', path: join(APP_SUPPORT, 'TRAE SOLO CN'), safe: false, hint: 'Trae Solo editor data' },
  ]
}

async function directorySize(path) {
  try {
    if (PLATFORM === 'win32') {
      const escaped = path.replace(/'/g, "''")
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-Command',
        `(Get-ChildItem -LiteralPath '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`,
      ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
      const bytes = Number(String(stdout).trim())
      return Number.isFinite(bytes) ? bytes : null
    }
    const { stdout } = await execFileAsync('du', ['-sk', path], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    const kb = Number.parseInt(String(stdout).split(/\s+/)[0], 10)
    return Number.isFinite(kb) ? kb * 1024 : null
  } catch {
    return null
  }
}

let diskCache = { at: 0, data: null }

/** Scan known AI directories; read-only, cached for a minute. */
export async function scanDisk(config, { fresh = false } = {}) {
  if (!fresh && diskCache.data !== null && Date.now() - diskCache.at < DISK_CACHE_MS) return diskCache.data
  const items = []
  for (const target of diskTargets()) {
    try {
      if (!(await stat(target.path)).isDirectory()) continue
    } catch {
      continue
    }
    const size = await directorySize(target.path)
    if (size === null) continue
    items.push({ ...target, size })
  }
  let free = null
  try {
    const info = await statfs(DSH_HOME)
    free = info.bavail * info.bsize
  } catch { /* free space is optional */ }
  const data = {
    ok: true,
    items: items.sort((a, b) => b.size - a.size),
    free,
    thresholdGB: config.diskThresholdGB,
    scannedAt: Date.now(),
  }
  diskCache = { at: Date.now(), data }
  return data
}

/** Delete only whitelisted cache targets; the id map is the security boundary. */
export async function cleanDisk(ids) {
  const safe = new Map(diskTargets().filter(target => target.safe).map(target => [target.id, target]))
  const cleaned = []
  const errors = []
  let freed = 0
  for (const id of Array.isArray(ids) ? ids : []) {
    const target = safe.get(String(id))
    if (!target) { errors.push({ id: String(id), error: 'NOT_SAFE' }); continue }
    const size = await directorySize(target.path) ?? 0
    try {
      await rm(target.path, { recursive: true, force: true })
      freed += size
      cleaned.push(target.id)
    } catch (error) {
      errors.push({ id: target.id, error: String(error?.message ?? error).slice(0, 160) })
    }
  }
  diskCache = { at: 0, data: null }
  return { ok: errors.length === 0, freed, cleaned, errors }
}

async function readJsonBody(req) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 1_000_000) throw new Error('BODY_TOO_LARGE')
  }
  return text === '' ? {} : JSON.parse(text)
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


const agentsCache = { at: 0, data: null }

/** WorkBuddy credits from its local session_usage table. */
export async function readWorkBuddy() {
  const db = await openSqlite(WORKBUDDY_DB)
  if (!db) return { ok: false, error: 'NO_WORKBUDDY_DB' }
  try {
    const rows = db.prepare('SELECT session_id, updated_at, credit_json FROM session_usage').all()
    const now = Date.now()
    const todayStart = startOfLocalDay(now)
    let total = 0
    let today = 0
    let sevenDays = 0
    let thirtyDays = 0
    for (const row of rows) {
      let credits = 0
      try {
        const map = JSON.parse(row.credit_json || '{}')
        for (const value of Object.values(map)) credits += Number(value) || 0
      } catch { /* a malformed row is skipped */ }
      total += credits
      const at = Number(row.updated_at) || 0
      if (at >= todayStart) today += credits
      if (at >= now - 7 * 86_400_000) sevenDays += credits
      if (at >= now - 30 * 86_400_000) thirtyDays += credits
    }
    return { ok: true, sessions: rows.length, credits: { total, today, sevenDays, thirtyDays } }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 140) }
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
}

const ZCODE_LABELS = {
  'builtin:zai-start-plan': 'Z.ai Start',
  'builtin:zai-coding-plan': 'Z.ai Coding',
  'builtin:bigmodel-coding-plan': 'BigModel Coding',
  'builtin:bigmodel-start-plan': 'BigModel Start',
}

/** ZCode only exposes plan entitlement locally, not token usage. */
export async function readZCode() {
  try {
    const data = JSON.parse(await readFile(ZCODE_PLAN, 'utf8'))
    const items = data?.entryStatus?.items ?? {}
    const plans = Object.entries(items).map(([id, value]) => ({
      id,
      label: ZCODE_LABELS[id] || id,
      status: value?.status ?? 'unknown',
      reason: value?.reason ?? null,
    }))
    return { ok: true, plans, updatedAt: Number(data?.entryStatus?.updatedAt) || null }
  } catch {
    return { ok: false, error: 'NO_ZCODE_PLAN' }
  }
}

/** Local AI tools beyond DSH/Cursor/Codex. Claude and Trae have no usable local usage API here. */
export async function readAgents({ fresh = false } = {}) {
  if (!fresh && agentsCache.data !== null && Date.now() - agentsCache.at < AGENTS_CACHE_MS) return agentsCache.data
  const [workbuddy, zcode] = await Promise.all([readWorkBuddy(), readZCode()])
  const data = {
    ok: true,
    items: [
      { id: 'workbuddy', name: 'WorkBuddy', kind: 'credits', ...workbuddy },
      { id: 'zcode', name: 'ZCode', kind: 'plan', ...zcode },
      { id: 'claude', name: 'Claude', kind: 'unavailable', reason: 'NO_LOCAL_USAGE' },
      { id: 'trae', name: 'Trae', kind: 'unavailable', reason: 'NO_LOCAL_USAGE' },
    ],
    updatedAt: Date.now(),
  }
  agentsCache.at = Date.now()
  agentsCache.data = data
  return data
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const token = randomUUID()
  const widgetSource = readFileSync(new URL('./widget.js', import.meta.url), 'utf8')
  const publicConfig = {
    refreshSeconds: config.refreshSeconds,
    lowBalanceThreshold: config.lowBalanceThreshold,
    dailyTokenLimit: config.dailyTokenLimit,
    diskThresholdGB: config.diskThresholdGB,
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
    path: '/quotapot/update-check',
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
      sendJson(res, 200, await checkUpdate({ fresh: url.searchParams.has('fresh') }))
    },
  }), 'quotapot: update check')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/update',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' })
        return
      }
      if (!tokenMatches(token, req.headers['x-quotapot-token'])) {
        sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' })
        return
      }
      sendJson(res, 200, await installUpdate(ctx))
    },
  }), 'quotapot: update install')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/disk',
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
      sendJson(res, 200, await scanDisk(config, { fresh: url.searchParams.has('fresh') }))
    },
  }), 'quotapot: disk scan')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/disk/clean',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' })
        return
      }
      if (!tokenMatches(token, req.headers['x-quotapot-token'])) {
        sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const ids = Array.isArray(body?.ids) ? body.ids : []
        if (ids.length === 0) {
          sendJson(res, 400, { ok: false, error: 'NO_TARGETS' })
          return
        }
        sendJson(res, 200, await cleanDisk(ids))
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message ?? error).slice(0, 160) })
      }
    },
  }), 'quotapot: disk clean')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/quotapot/agents',
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
      sendJson(res, 200, await readAgents({ fresh: url.searchParams.has('fresh') }))
    },
  }), 'quotapot: other agents')

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

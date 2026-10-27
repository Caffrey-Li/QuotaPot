import { execFile, spawn as spawnProcess } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { CONTEXT_WARN_PERCENT, contextTrend } from '../context.mjs'
import { degrade } from '../degrade.mjs'
import { renderPrompt } from '../prompts.mjs'
import { persistSnapshot, snapshot } from '../snapshot.mjs'
import { openRead, openWrite, textRows } from '../sqlite.mjs'

export { CONTEXT_WARN_PERCENT, contextSave, contextTrend } from '../context.mjs'

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 15_000
const SECRET_PREFIX = 'cursor-safe-storage:v1:'
let decryptedSecret
let decrypting

export const id = 'cursor'
export const name = 'Cursor'

export const capabilities = {
  usage: true,
  chats: true,
  quota: true,
  modelStatus: true,
  actions: { open: process.platform === 'darwin', paste: 'place', spawn: true },
}

export const promptProfile = {
  product: 'Cursor',
  instructionsFile: 'AGENTS.md',
  compactCommand: '',
  hasContext: true,
  warnPercent: CONTEXT_WARN_PERCENT,
}

export function discover() {
  const file = cursorDbPath()
  if (!fs.existsSync(file)) return { ...degrade('没有安装 Cursor'), installed: false }
  return { ok: true, installed: true, home: homeOf(path.dirname(path.dirname(path.dirname(file)))) }
}

export function cursorSupportDir() {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor')
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cursor')
  return path.join(home, '.config', 'Cursor')
}

export function unsealCursorSecret(stored, key) {
  const blob = Buffer.from(String(stored).slice(SECRET_PREFIX.length), 'base64')
  if (blob.subarray(0, 3).toString() !== 'v10' || key.length !== 32 || blob.length < 3 + 12 + 16) return stored
  const nonce = blob.subarray(3, 15)
  const tag = blob.subarray(blob.length - 16)
  const data = blob.subarray(15, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function cursorDbPath() {
  return path.join(cursorSupportDir(), 'User', 'globalStorage', 'state.vscdb')
}

function homeOf(target) {
  const home = os.homedir()
  return String(target || '').startsWith(home) ? `~${String(target).slice(home.length)}` : target
}

function readText(sql, params = []) {
  const file = cursorDbPath()
  if (!fs.existsSync(file)) return ''
  let db
  try {
    db = openRead(file)
    return textRows(db, sql, params)
  } catch {
    return ''
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

function readValue(sql, params = []) {
  const file = cursorDbPath()
  if (!fs.existsSync(file)) return ''
  let db
  try {
    db = openRead(file)
    const row = db.prepare(sql).get(...params)
    const value = row ? Object.values(row)[0] : ''
    return value == null ? '' : String(value)
  } catch {
    return ''
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

async function windowsSafeKey() {
  const file = path.join(cursorSupportDir(), 'Local State')
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const raw = Buffer.from(json.os_crypt.encrypted_key, 'base64')
  if (raw.subarray(0, 5).toString() !== 'DPAPI') throw new Error('Cursor 登录信息无法读取')
  const encoded = raw.subarray(5).toString('base64')
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${encoded}'); $p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); [Convert]::ToBase64String($p)`,
  ], { encoding: 'utf8', timeout: 12_000, windowsHide: true })
  return Buffer.from(String(stdout).trim(), 'base64')
}

async function decryptCursorSecret(stored) {
  if (!stored.startsWith(SECRET_PREFIX)) return stored
  if (process.platform === 'win32') return unsealCursorSecret(stored, await windowsSafeKey())
  if (process.platform !== 'darwin') return stored
  if (decryptedSecret && decryptedSecret.stored === stored) return decryptedSecret.plain
  if (decrypting) return decrypting
  decrypting = (async () => {
    const blob = Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64')
    if (blob.subarray(0, 3).toString() !== 'v10') return stored
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password', '-s', 'Cursor Safe Storage', '-a', 'Cursor', '-w',
    ], { encoding: 'utf8', timeout: 12_000 })
    const key = pbkdf2Sync(String(stdout).trim(), 'saltysalt', 1003, 16, 'sha1')
    const iv = Buffer.alloc(16, ' ')
    const decipher = createDecipheriv('aes-128-cbc', key, iv)
    const plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString('utf8')
    decryptedSecret = { stored, plain }
    return plain
  })()
  try {
    return await decrypting
  } finally {
    decrypting = null
  }
}

async function cursorToken() {
  const storedRaw = readValue("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'")
  if (!storedRaw && !fs.existsSync(cursorDbPath())) throw new Error('找不到 Cursor 登录数据库')
  let stored
  try {
    stored = await decryptCursorSecret(String(storedRaw).trim())
  } catch {
    throw new Error(process.platform === 'win32' ? '需要允许读取 Cursor 的本机登录信息' : '需要允许钥匙串访问（Cursor Safe Storage）')
  }
  if (!stored) throw new Error('Cursor 未登录')
  if (stored.startsWith(SECRET_PREFIX)) {
    throw new Error(process.platform === 'win32' ? '需要允许读取 Cursor 的本机登录信息' : '需要允许钥匙串访问（Cursor Safe Storage）')
  }
  return stored
}

export function summarizeCursor(usage, planName) {
  const plan = usage && usage.planUsage
  if (!plan || plan.limit === undefined) throw new Error('没有 Cursor 用量数据')
  const limitCents = Number(plan.limit) || 0
  const usedCents = Number(plan.includedSpend) || 0
  const remainingCents = Number.isFinite(Number(plan.remaining))
    ? Number(plan.remaining)
    : Math.max(0, limitCents - usedCents)
  const fromMessage = /(\d+(?:\.\d+)?)\s*%/.exec(String(usage.displayMessage || ''))
  const usedPercent = fromMessage
    ? Number(fromMessage[1])
    : Number.isFinite(Number(plan.totalPercentUsed))
      ? Number(plan.totalPercentUsed)
      : (limitCents > 0 ? ((limitCents - remainingCents) / limitCents) * 100 : 0)
  return {
    ok: true,
    unit: 'percent',
    planName: planName || null,
    limitCents,
    usedCents,
    remainingCents,
    usedPercent: Math.round(usedPercent * 10) / 10,
    autoPercentUsed: Number(plan.autoPercentUsed) || 0,
    apiPercentUsed: Number(plan.apiPercentUsed) || 0,
    billingCycleEnd: Number(usage.billingCycleEnd) || null,
    displayMessage: usage.displayMessage || null,
  }
}

export function formatTokens(value) {
  const number = Number(value) || 0
  if (number >= 1e9) return `${(number / 1e9).toFixed(2)}B`
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`
  if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`
  return String(number)
}

async function cursorUsage() {
  const token = await cursorToken()
  const post = (rpc) => fetch(`https://api2.cursor.sh${rpc}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      'user-agent': 'quotapot-desktop/0.3.0',
    },
    body: '{}',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const [usageRes, planRes] = await Promise.all([
    post('/aiserver.v1.DashboardService/GetCurrentPeriodUsage'),
    post('/aiserver.v1.DashboardService/GetPlanInfo'),
  ])
  if (usageRes.status === 401 || usageRes.status === 403) throw new Error('Cursor 登录已失效')
  if (!usageRes.ok) throw new Error(`Cursor HTTP ${usageRes.status}`)
  const usage = await usageRes.json()
  let planName = null
  if (planRes.ok) {
    const plan = await planRes.json()
    planName = plan?.planInfo?.planName || null
  }
  return summarizeCursor(usage, planName)
}

export async function menu() {
  try {
    return await cursorUsage()
  } catch (error) {
    return degrade(error.message || '读不到 Cursor 额度')
  }
}

function rangeStart(days) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (Math.max(1, Number(days) || 1) - 1))
  return date.getTime()
}

async function cursorRpc(method, body) {
  const token = await cursorToken()
  const response = await fetch(`https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      'user-agent': 'quotapot-desktop/0.4.1',
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 401 || response.status === 403) throw new Error('Cursor 登录已失效')
  if (!response.ok) throw new Error(`Cursor HTTP ${response.status}`)
  return response.json()
}

function addUsage(bucket, usage) {
  bucket.input += Number(usage?.inputTokens) || 0
  bucket.output += Number(usage?.outputTokens) || 0
  bucket.cacheRead += Number(usage?.cacheReadTokens) || 0
  bucket.cacheWrite += Number(usage?.cacheWriteTokens) || 0
  bucket.calls += 1
  bucket.tokens = bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite
}

export function aggregateUsage(events, start) {
  const models = new Map()
  for (const event of events) {
    const at = Number(event.timestamp) || 0
    if (at && at < start) continue
    const model = String(event.model || '未知模型')
    const modelBucket = models.get(model) || { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, tokens: 0 }
    addUsage(modelBucket, event.tokenUsage || {})
    models.set(model, modelBucket)
  }
  const modelRows = [...models.values()].sort((a, b) => b.tokens - a.tokens)
  return {
    tokens: modelRows.reduce((sum, item) => sum + item.tokens, 0),
    calls: modelRows.reduce((sum, item) => sum + item.calls, 0),
    models: modelRows,
  }
}

export function peekUsage(days) {
  return snapshot().usage?.[String(Number(days) || 1)] || null
}

export async function usage(days = 1, onProgress = () => {}) {
  const found = discover()
  if (!found.installed) return found
  const start = rangeStart(days)
  const end = Date.now()
  const events = []
  let total = Infinity
  let truncated = false
  const cap = 6
  let pages = Number(days) > 1 ? cap : 1
  const started = Date.now()
  const report = (done, label) => {
    const elapsed = Date.now() - started
    const etaMs = done > 0 ? Math.round((elapsed / done) * Math.max(0, pages - done)) : (pages > 1 ? 12000 : 2500)
    onProgress({ done, total: pages, label, etaMs })
  }
  report(0, '用量')
  for (let page = 1; page <= cap && events.length < total; page += 1) {
    report(page - 1, '第 ' + page + ' 页')
    const data = await cursorRpc('GetFilteredUsageEvents', {
      startDate: String(start),
      endDate: String(end),
      page,
      pageSize: 500,
    })
    const batch = Array.isArray(data.usageEventsDisplay) ? data.usageEventsDisplay : []
    total = Number(data.totalUsageEventsCount) || events.length + batch.length
    pages = Math.min(cap, Math.max(1, Math.ceil(total / 500)))
    events.push(...batch)
    report(page, '第 ' + page + ' 页')
    if (batch.length < 500) break
    if (page === cap && events.length < total) truncated = true
  }
  const totals = aggregateUsage(events, start)
  report(pages, '汇总')
  const result = {
    ok: true,
    source: 'cursor',
    unit: 'token',
    days: Number(days) || 1,
    truncated,
    ...totals,
  }
  const store = snapshot()
  store.usage = store.usage || {}
  store.usage[String(result.days)] = result
  persistSnapshot()
  return result
}

const MODEL_STATUS = {
  1: ['降级', 'Cursor 标记这个模型变慢或质量下降，可以换一个模型再试。'],
  2: ['停用', 'Cursor 已暂停这个模型，请求会被拒绝。'],
}

const MODEL_ERRORS = [
  [/invalid api key|incorrect api key|invalid_api_key/i, '密钥无效。到 Cursor 设置里重新填写这个外部模型的 API Key。'],
  [/401|unauthorized/i, '外部接口拒绝访问。密钥错了，或这个密钥没有调用该模型的权限。'],
  [/429|rate limit|too many requests/i, '请求太密，外部模型在限流。等一会儿，或换一个模型。'],
  [/context length|maximum context|context window|too long/i, '上下文超过这个模型的窗口。先整理再开新对话，或换一个窗口更大的模型。'],
  [/timeout|timed out/i, '外部模型超时，没有在时限内返回。'],
  [/502|503|504|overloaded|unavailable/i, '外部模型服务暂时不可用，可以稍后重试。'],
  [/quota|insufficient_quota|billing/i, '外部账号额度用完，或账单不允许继续调用。'],
]

export function modelStatus(code) {
  const known = MODEL_STATUS[Number(code)]
  if (!known) return { status: 0, statusText: '正常', detail: '' }
  return { status: Number(code), statusText: known[0], detail: known[1] }
}

function explainModelError(text) {
  const value = String(text || '').trim()
  if (!value || value === 'false') return ''
  for (const [pattern, hint] of MODEL_ERRORS) {
    if (pattern.test(value)) return hint
  }
  return '外部模型返回了错误：' + value.slice(0, 120)
}

export function modelsFromCatalog(user) {
  const providers = []
  if (user.useOpenAIKey) providers.push('OpenAI 密钥')
  if (user.useClaudeKey) providers.push('Anthropic 密钥')
  if (user.useGoogleKey) providers.push('Google 密钥')
  if (user.azureState && user.azureState.useAzure) providers.push('Azure')
  if (user.bedrockState && user.bedrockState.useBedrock) providers.push('Bedrock')
  if (typeof user.openAIBaseUrl === 'string' && user.openAIBaseUrl.trim()) providers.push('自定义接口')
  const ownModels = Array.isArray(user.availableAPIKeyModels) ? user.availableAPIKeyModels : []
  const external = providers.length > 0 || ownModels.length > 0
  const models = []
  const seen = new Set()
  for (const item of Array.isArray(user.availableDefaultModels2) ? user.availableDefaultModels2 : []) {
    const modelName = String(item.clientDisplayName || item.name || '未命名模型')
    const modelId = String(item.serverModelName || item.name || modelName)
    if (seen.has(modelId)) continue
    seen.add(modelId)
    const status = modelStatus(item.degradationStatus)
    const warning = item.tooltipData && typeof item.tooltipData.secondaryWarningText === 'string'
      ? item.tooltipData.secondaryWarningText
      : ''
    models.push({
      name: modelName,
      vendor: String(item.vendorName || ''),
      status: status.status,
      statusText: status.statusText,
      detail: status.detail || explainModelError(warning),
    })
  }
  for (const item of ownModels) {
    const modelName = typeof item === 'string' ? item : String(item.name || item.model || '')
    if (!modelName || seen.has(modelName)) continue
    seen.add(modelName)
    models.push({ name: modelName, vendor: '外部', status: 0, statusText: '正常', detail: '外部 · 用你自己的密钥调用' })
  }
  models.sort((a, b) => b.status - a.status || a.name.localeCompare(b.name, 'zh'))
  return {
    ok: true,
    external,
    headline: external
      ? '已接入外部模型（' + providers.join('、') + '）。下面是全部模型。'
      : '未接入外部模型。下面是 Cursor 目录里的全部模型。',
    note: '只提示降级和停用的模型。报错会写成中文说明。',
    models,
  }
}

export function models() {
  const found = discover()
  if (!found.installed) return found
  const raw = readValue(`SELECT value FROM ItemTable WHERE key = 'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser'`).trim()
  if (!raw) return degrade('读不到 Cursor 的模型目录')
  try {
    return modelsFromCatalog(JSON.parse(raw))
  } catch {
    return degrade('模型目录解析失败')
  }
}

function workspaceName(fsPath) {
  const parts = String(fsPath || '').split(/[/\\]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

function quoteId(value) {
  return /^[0-9a-f-]{36}$/i.test(value) ? `'${value}'` : ''
}

function composerSelect(where) {
  return `
    SELECT replace(replace(replace(coalesce(json_extract(value,'$.composerId'), ''), '~|~', ''), char(10), ' '), char(9), ' ') || '~|~' ||
           replace(replace(replace(coalesce(json_extract(value,'$.name'), ''), '~|~', ' '), char(10), ' '), char(9), ' ') || '~|~' ||
           replace(coalesce(json_extract(value,'$.modelConfig.modelName'), ''), '~|~', '') || '~|~' ||
           coalesce(json_extract(value,'$.contextTokensUsed'), 0) || '~|~' ||
           coalesce(json_extract(value,'$.contextTokenLimit'), 0) || '~|~' ||
           coalesce(json_extract(value,'$.contextUsagePercent'), 0) || '~|~' ||
           coalesce(json_extract(value,'$.lastUpdatedAt'), 0) || '~|~' ||
           coalesce(json_extract(value,'$.createdAt'), 0) || '~|~' ||
           replace(coalesce(json_extract(value,'$.workspaceIdentifier.uri.fsPath'), ''), '~|~', '') || '~|~' ||
           coalesce(json_extract(value,'$.isSubagent'), 0) || '~|~' ||
           replace(replace(coalesce(json_extract(value,'$.promptTokenBreakdown.categories'), '[]'), char(10), ''), '~|~', '')
    FROM cursorDiskKV WHERE ${where}`
}

export function parseComposerLine(line) {
  const [composerId, composerName, model, used, limit, percent, updatedAt, createdAt, workspacePath, subagent, categories] = line.split('~|~')
  if (!quoteId(composerId) || subagent === '1') return null
  let summary = 0
  let conversation = 0
  try {
    for (const category of JSON.parse(categories || '[]')) {
      if (category?.id === 'summarized_conversation') summary = Number(category.estimatedTokens) || 0
      if (category?.id === 'conversation') conversation = Number(category.estimatedTokens) || 0
    }
  } catch { /* category payload is optional */ }
  return {
    id: composerId,
    name: String(composerName || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    model: model || '未知模型',
    used: Number(used) || 0,
    limit: Number(limit) || 0,
    percent: Number(percent) || 0,
    updatedAt: Number(updatedAt) || 0,
    createdAt: Number(createdAt) || 0,
    workspace: workspaceName(workspacePath),
    summary,
    conversation,
  }
}

function headerIndex() {
  const headers = []
  for (const line of readText(`
    SELECT composerId || '~|~' || coalesce(lastUpdatedAt, 0) || '~|~' || coalesce(isSubagent, 0) || '~|~' ||
           coalesce(json_extract(value,'$.isDraft'), 0) || '~|~' ||
           coalesce(json_extract(value,'$.contextUsagePercent'), 0)
    FROM composerHeaders
  `).split('\n')) {
    if (!line) continue
    const [composerId, updatedAt, subagent, draft, percent] = line.split('~|~')
    if (!quoteId(composerId) || subagent === '1' || draft === '1') continue
    headers.push({ id: composerId, updatedAt: Number(updatedAt) || 0, percent: Number(percent) || 0 })
  }
  return headers
}

let composerCache = { at: 0, rows: [] }

function loadComposers() {
  if (Date.now() - composerCache.at < 60_000 && composerCache.rows.length) return composerCache.rows
  if (!fs.existsSync(cursorDbPath())) return composerCache.rows
  const previous = new Map((snapshot().composers || []).map((row) => [row.id, row]))
  const headers = headerIndex()
  const stale = []
  const rows = []
  for (const header of headers) {
    const saved = previous.get(header.id)
    if (saved && saved.updatedAt === header.updatedAt && Math.abs((saved.percent || 0) - header.percent) < 0.05) rows.push(saved)
    else stale.push(header.id)
  }
  if (!headers.length && !rows.length) {
    for (const line of readText(composerSelect(`key LIKE 'composerData:%'`)).split('\n')) {
      if (!line) continue
      const row = parseComposerLine(line)
      if (row) rows.push(row)
    }
  } else if (stale.length) {
    const keys = stale.map((item) => `'composerData:${item}'`).join(',')
    for (const line of readText(composerSelect(`key IN (${keys})`)).split('\n')) {
      if (!line) continue
      const row = parseComposerLine(line)
      if (row) rows.push(row)
    }
  }
  if (!rows.length) return composerCache.rows
  composerCache = { at: Date.now(), rows }
  snapshot().composers = rows
  persistSnapshot()
  return rows
}

const sampleCache = new Map()

function contextSamples(composerId) {
  if (!/^[0-9a-f-]{36}$/i.test(composerId)) return []
  const cached = sampleCache.get(composerId)
  if (cached && Date.now() - cached.at < 60_000) return cached.rows
  const text = readText(`
      SELECT json_extract(value,'$.createdAt') || '~|~' ||
             json_extract(value,'$.contextWindowStatusAtCreation.tokensUsed')
      FROM cursorDiskKV
      WHERE key LIKE ?
        AND json_extract(value,'$.contextWindowStatusAtCreation.tokensUsed') IS NOT NULL
    `, [`bubbleId:${composerId}:%`])
  const rows = String(text).split('\n').filter(Boolean).map((line) => {
    const [at, used] = line.split('~|~')
    const parsed = Date.parse(at)
    return { at: Number.isFinite(parsed) ? parsed : Number(at) || 0, used: Number(used) || 0 }
  })
  sampleCache.set(composerId, { at: Date.now(), rows })
  return rows
}

export function peekContext() {
  return snapshot().context || null
}

export async function chats(onProgress = () => {}) {
  const found = discover()
  if (!found.installed) return found
  const started = Date.now()
  const report = (done, total, label) => {
    const elapsed = Date.now() - started
    const etaMs = done > 0 ? Math.round((elapsed / done) * Math.max(0, total - done)) : 8000
    onProgress({ done, total, label, etaMs })
  }
  report(0, 1, '对话列表')
  const list = loadComposers()
    .filter((item) => item.limit > 0 && item.used > 0)
    .sort((a, b) => b.percent - a.percent)
  const hot = list.filter((item) => item.percent >= CONTEXT_WARN_PERCENT).slice(0, 12)
  const total = hot.length + 1
  report(1, total, '对话列表')
  const savedTrends = snapshot().trends || {}
  const trends = new Map()
  for (const [index, item] of hot.entries()) {
    report(index + 1, total, item.name || '对话')
    const saved = savedTrends[item.id]
    if (saved && saved.updatedAt === item.updatedAt) trends.set(item.id, saved)
    else {
      const trend = contextTrend(contextSamples(item.id))
      const stored = { updatedAt: item.updatedAt, compactions: trend.compactions, lostRatio: trend.lostRatio, growth: trend.growth }
      savedTrends[item.id] = stored
      trends.set(item.id, stored)
    }
    report(index + 2, total, item.name || '对话')
  }
  snapshot().trends = savedTrends
  const context = {
    ok: true,
    warnPercent: CONTEXT_WARN_PERCENT,
    chats: list.map((item) => {
      const trend = trends.get(item.id)
      const measured = Boolean(trend)
      return {
        ...item,
        measured,
        compactions: measured ? trend.compactions : 0,
        lostRatio: measured ? (trend.lostRatio ?? 0) : null,
        growth: measured ? trend.growth : null,
        warn: item.percent >= CONTEXT_WARN_PERCENT,
      }
    }),
  }
  snapshot().context = context
  persistSnapshot()
  return context
}

export function headers() {
  const found = discover()
  if (!found.installed) return found
  const text = readText(`
      SELECT composerId || '~|~' || coalesce(createdAt, 0) || '~|~' || coalesce(isSubagent, 0) || '~|~' ||
             replace(replace(coalesce(json_extract(value,'$.name'), ''), char(10), ' '), '~|~', ' ') || '~|~' ||
             coalesce(json_extract(value,'$.isDraft'), 0)
      FROM composerHeaders
    `)
  const rows = []
  for (const line of String(text).split('\n')) {
    if (!line) continue
    const [composerId, createdAt, subagent, composerName, draft] = line.split('~|~')
    if (!/^[0-9a-f-]{36}$/i.test(composerId || '') || subagent === '1' || draft === '1') continue
    rows.push({
      id: composerId,
      createdAt: Number(createdAt) || 0,
      name: String(composerName || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    })
  }
  return { ok: true, chats: rows }
}

export function prompts(kind, chat) {
  const allowed = ['new', 'handoff', 'inherit', 'crash']
  if (!allowed.includes(kind)) return degrade('没有这种提示词')
  return { ok: true, kind, text: renderPrompt(promptProfile, kind, chat || null) }
}

export function composerRichText(text) {
  const lines = String(text).split('\n')
  const children = (lines.length ? lines : ['']).map((line) => ({
    children: line ? [{ detail: 0, format: 0, mode: 'normal', style: '', text: line, type: 'text', version: 1 }] : [],
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  }))
  return JSON.stringify({ root: { children, format: '', indent: 0, type: 'root', version: 1 } })
}

function lexicalPlain(richText) {
  const root = JSON.parse(richText).root
  return (root.children || []).map((para) => (para.children || []).map((node) => node.text || '').join('')).join('\n')
}

function writeComposerDraft(composerId, text) {
  const file = cursorDbPath()
  const db = openWrite(file)
  const key = `composerData:${composerId}`
  try {
    const rich = composerRichText(text)
    const result = db.prepare(`UPDATE cursorDiskKV SET value = json_set(CAST(value AS TEXT), '$.text', ?, '$.richText', ?) WHERE key = ?`)
      .run(text, rich, key)
    if (result.changes < 1) return false
    const row = db.prepare(`SELECT json_extract(CAST(value AS TEXT), '$.text') AS text, json_extract(CAST(value AS TEXT), '$.richText') AS richText FROM cursorDiskKV WHERE key = ?`).get(key)
    return Boolean(row && row.text === text && lexicalPlain(row.richText) === text)
  } finally {
    db.close()
  }
}

async function cursorIsRunning() {
  try {
    if (process.platform === 'win32') {
      const probe = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe', '/NH'], { timeout: 4000, windowsHide: true })
      return /Cursor\.exe/i.test(probe.stdout)
    }
    const probe = await execFileAsync('ps', ['-ax', '-o', 'comm='], { timeout: 2000 })
    return probe.stdout.split('\n').some((line) => line.trim().endsWith('/MacOS/Cursor'))
  } catch {
    return false
  }
}

function copyToClipboard(value) {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawnProcess('clip.exe', [], { windowsHide: true })
      : spawnProcess('pbcopy')
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('复制失败'))))
    child.stdin.end(value)
  })
}

export async function paste({ text, chatId } = {}) {
  const value = String(text || '').slice(0, 8000)
  if (!value.trim()) return { ok: false, copied: false, error: '没有可粘贴的内容' }
  if (chatId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(chatId))) return { ok: false, copied: false, error: '对话编号无效' }
    try {
      const wrote = writeComposerDraft(String(chatId), value)
      if (!wrote) return { ok: false, copied: false, error: '没找到这条对话' }
    } catch {
      return { ok: false, copied: false, error: '没能写入这条对话，稍后再试' }
    }
    return { ok: true, copied: true, placed: true }
  }
  await copyToClipboard(value)
  if (process.platform !== 'darwin') return { ok: false, copied: true, error: '已复制。请在 Cursor 里粘贴。' }
  try {
    await execFileAsync('osascript', ['-e', 'tell application "Cursor" to activate\ndelay 0.2\ntell application "System Events" to keystroke "v" using command down'], { timeout: 8000 })
  } catch {
    return { ok: false, copied: true, error: '已复制，但没能粘贴到 Cursor。请允许辅助功能，或手动粘贴。' }
  }
  return { ok: true, copied: true }
}

export function cursorPromptUrl(text, workspace) {
  const params = new URLSearchParams()
  params.set('text', String(text || '').slice(0, 8000))
  if (workspace) params.set('workspace', String(workspace).slice(0, 180))
  return `cursor://anysphere.cursor-deeplink/prompt?${params.toString()}`
}

export async function spawn({ text, workspace } = {}) {
  const value = String(text || '').trim()
  if (!value) return { ok: false, error: '没有可放入新对话的内容' }
  if (!(await cursorIsRunning())) return { ok: false, error: 'Cursor 没有在运行' }
  const url = cursorPromptUrl(value, workspace)
  try {
    if (process.platform === 'win32') await execFileAsync('cmd.exe', ['/c', 'start', '', url], { timeout: 8000, windowsHide: true })
    else await execFileAsync('open', ['-g', url], { timeout: 8000 })
  } catch {
    return { ok: false, error: '没能在原项目里开新对话' }
  }
  return { ok: true, spawned: true, workspace: workspace || '' }
}

const OPEN_CHORD = 'ctrl+alt+cmd+shift+q'
let openChain = Promise.resolve()
let armedBinding = null
let armTimer = null

function keybindingsPath() {
  return path.join(cursorSupportDir(), 'User', 'keybindings.json')
}

function restoreArmed(ticket) {
  const current = armedBinding
  if (!current || (ticket != null && current.ticket !== ticket)) return
  armedBinding = null
  clearTimeout(armTimer)
  try {
    if (current.existed) fs.writeFileSync(current.file, current.original)
    else fs.unlinkSync(current.file)
  } catch { /* leave the shortcut file if it cannot be put back */ }
}

async function runOpen(chatId, phase, ticket) {
  if (process.platform !== 'darwin') return { ok: false, error: 'Windows 上还不能跳进 Cursor 对话' }
  if (phase === 'done') {
    restoreArmed(Number(ticket))
    return { ok: true }
  }
  const composerId = String(chatId || '')
  if (!/^[0-9a-f-]{36}$/i.test(composerId)) return { ok: false, error: '对话编号无效' }
  if (!(await cursorIsRunning())) return { ok: false, error: 'Cursor 没有在运行' }
  const file = keybindingsPath()
  let original = null
  let existed = true
  try {
    original = fs.readFileSync(file, 'utf8')
  } catch {
    existed = false
  }
  if (armedBinding?.file === file) {
    original = armedBinding.original
    existed = armedBinding.existed
  }
  const binding = { key: OPEN_CHORD, command: 'canvas.openAgentByConversationId', args: composerId }
  let next
  if (!existed) next = JSON.stringify([binding], null, 2) + '\n'
  else {
    let parsed
    try {
      parsed = JSON.parse(original)
    } catch {
      return { ok: false, error: '快捷键文件不是纯 JSON，没能临时写入' }
    }
    if (!Array.isArray(parsed)) return { ok: false, error: '快捷键文件格式无法识别' }
    const kept = parsed.filter((item) => !(item && item.key === OPEN_CHORD))
    next = JSON.stringify([...kept, binding], null, 2) + '\n'
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next)
  const mine = (armedBinding?.ticket || 0) + 1
  armedBinding = { ticket: mine, file, existed, original }
  clearTimeout(armTimer)
  armTimer = setTimeout(() => restoreArmed(mine), 4000)
  await new Promise((resolve) => setTimeout(resolve, 700))
  return { ok: true, ticket: mine, bridge: true }
}

export function open({ chatId, phase = 'arm', ticket } = {}) {
  const job = openChain.then(() => runOpen(chatId, phase, ticket), () => runOpen(chatId, phase, ticket))
  openChain = job.then(() => {}, () => {})
  return job
}

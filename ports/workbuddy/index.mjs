import { execFile, spawn as spawnProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { CONTEXT_WARN_PERCENT } from '../context.mjs'
import { degrade } from '../degrade.mjs'
import { renderPrompt } from '../prompts.mjs'
import { persistSnapshot, snapshot } from '../snapshot.mjs'
import { openRead } from '../sqlite.mjs'

const execFileAsync = promisify(execFile)

export const id = 'workbuddy'
export const name = 'WorkBuddy'

// WorkBuddy keeps everything local in ~/.workbuddy/workbuddy.db. There is no
// local plan/quota file, and the only local control channel (the eval proxy on
// 127.0.0.1) can open a conversation but cannot write into the input box.
export const capabilities = {
  discover: true,
  usage: true,
  models: true,
  chats: true,
  prompts: true,
  disk: true,
  menu: false,
  actions: { open: true, paste: false, spawn: false },
}

// WorkBuddy reads project instructions from CODEBUDDY.md first
// (.codebuddy/CODEBUDDY.md and AGENTS.md are the fallbacks). /compact is a real
// slash command in the product.
export const promptProfile = {
  product: 'WorkBuddy',
  instructionsFile: 'CODEBUDDY.md',
  compactCommand: '/compact',
  hasContext: true,
  warnPercent: CONTEXT_WARN_PERCENT,
}

export function workbuddyDbPath() {
  return path.join(os.homedir(), '.workbuddy', 'workbuddy.db')
}

export function discoverFrom(file) {
  if (!file || !fs.existsSync(file)) {
    return { ...degrade('没有安装 WorkBuddy（找不到 ~/.workbuddy/workbuddy.db）'), installed: false }
  }
  return { ok: true, installed: true, home: '~/.workbuddy' }
}

export function discover() {
  return discoverFrom(workbuddyDbPath())
}

// session_usage: used = context tokens used, size = context window,
// updated_at = milliseconds, credit_json = { requestId: credits }.
export const USAGE_SQL = `
  SELECT session_id AS sessionId, used, size, updated_at AS updatedAt, credit_json AS creditJson
  FROM session_usage`

export const SESSION_SQL = `
  SELECT id, title, custom_title AS customTitle, model, cwd,
         created_at AS createdAt, updated_at AS updatedAt
  FROM sessions WHERE deleted_at IS NULL`

export function readUsageRows(file = workbuddyDbPath()) {
  if (!file || !fs.existsSync(file)) return []
  let db
  try {
    db = openRead(file)
    return db.prepare(USAGE_SQL).all().map((row) => ({
      sessionId: String(row.sessionId || ''),
      used: Number(row.used) || 0,
      size: Number(row.size) || 0,
      updatedAt: Number(row.updatedAt) || 0,
      creditJson: row.creditJson == null ? '' : String(row.creditJson),
    }))
  } catch {
    return []
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

export function readSessionRows(file = workbuddyDbPath()) {
  if (!file || !fs.existsSync(file)) return []
  let db
  try {
    db = openRead(file)
    return db.prepare(SESSION_SQL).all().map((row) => ({
      id: String(row.id || ''),
      title: row.title == null ? '' : String(row.title),
      customTitle: row.customTitle == null ? '' : String(row.customTitle),
      model: row.model == null ? '' : String(row.model),
      cwd: row.cwd == null ? '' : String(row.cwd),
      createdAt: Number(row.createdAt) || 0,
      updatedAt: Number(row.updatedAt) || 0,
    }))
  } catch {
    return []
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

// credit_json keys are request ids, not model names; the value is the credits
// spent on that request.
export function parseCredits(text) {
  if (!text) return { credits: 0, calls: 0 }
  let map
  try {
    map = JSON.parse(text)
  } catch {
    return { credits: 0, calls: 0 }
  }
  if (!map || typeof map !== 'object') return { credits: 0, calls: 0 }
  let credits = 0
  let calls = 0
  for (const value of Object.values(map)) {
    const number = Number(value)
    if (!Number.isFinite(number)) continue
    credits += number
    calls += 1
  }
  return { credits, calls }
}

export function hasCredits(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => parseCredits(row.creditJson).calls > 0)
}

export function dayStart(days = 1, now = Date.now()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (Math.max(1, Number(days) || 1) - 1))
  return date.getTime()
}

export function aggregateCredits(rows, start = 0) {
  let credits = 0
  let calls = 0
  let sessions = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.updatedAt && row.updatedAt < start) continue
    const parsed = parseCredits(row.creditJson)
    if (!parsed.calls) continue
    credits += parsed.credits
    calls += parsed.calls
    sessions += 1
  }
  return { credits: round2(credits), calls, sessions }
}

// Credits live per session, so a model only gets what its sessions spent.
// A session that switched model mid-way is counted on its last model.
export function creditsByModel(rows, sessions, start = 0) {
  const modelOf = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session.id) modelOf.set(session.id, String(session.model || '').trim())
  }
  const buckets = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.updatedAt && row.updatedAt < start) continue
    const parsed = parseCredits(row.creditJson)
    if (!parsed.calls) continue
    const model = modelOf.get(row.sessionId) || '未知模型'
    const bucket = buckets.get(model) || { model, credits: 0, calls: 0, sessions: 0 }
    bucket.credits += parsed.credits
    bucket.calls += parsed.calls
    bucket.sessions += 1
    buckets.set(model, bucket)
  }
  return [...buckets.values()]
    .sort((a, b) => b.credits - a.credits || a.model.localeCompare(b.model, 'zh'))
    .map((item) => ({ model: item.model, credits: round2(item.credits), calls: item.calls, sessions: item.sessions }))
}

export function usageFromRows(rows, sessions, days = 1, now = Date.now()) {
  const start = dayStart(days, now)
  const totals = aggregateCredits(rows, start)
  const byModel = creditsByModel(rows, sessions, start)
  return {
    ok: true,
    source: 'workbuddy',
    unit: 'credits',
    days: Number(days) || 1,
    truncated: false,
    tokens: totals.credits,
    credits: totals.credits,
    calls: totals.calls,
    sessions: totals.sessions,
    models: byModel.map((item) => ({
      model: item.model,
      tokens: item.credits,
      calls: item.calls,
      sessions: item.sessions,
    })),
    note: 'credits 按 session_usage.updated_at（毫秒）分天，一次会话跨天时全部 credits 记在最后更新那天。',
  }
}

export async function usage(days = 1, onProgress = () => {}) {
  const found = discover()
  if (!found.installed) return found
  const started = Date.now()
  const total = 3
  const report = (done, label) => {
    const elapsed = Date.now() - started
    const etaMs = done > 0 ? Math.round((elapsed / done) * Math.max(0, total - done)) : 1500
    onProgress({ done, total, label, etaMs })
  }
  report(0, '用量')
  const rows = readUsageRows()
  if (!rows.length) return degrade('workbuddy.db 里读不到 session_usage')
  report(1, '会话')
  const sessions = readSessionRows()
  if (!hasCredits(rows)) return degrade('workbuddy.db 的 session_usage 里没有 credits 记录')
  const result = usageFromRows(rows, sessions, days)
  report(2, '汇总')
  const store = snapshot()
  store.workbuddy = store.workbuddy || {}
  store.workbuddy.usage = store.workbuddy.usage || {}
  store.workbuddy.usage[String(result.days)] = result
  persistSnapshot()
  report(total, '汇总')
  return result
}

function creditAmount(value) {
  const number = round2(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

export function modelsFromRows(rows, sessions) {
  const credits = new Map(creditsByModel(rows, sessions, 0).map((item) => [item.model, item]))
  const seen = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const model = String(session.model || '').trim()
    if (!model) continue
    const bucket = seen.get(model) || { model, sessions: 0, lastAt: 0 }
    bucket.sessions += 1
    if (Number(session.updatedAt) > bucket.lastAt) bucket.lastAt = Number(session.updatedAt)
    seen.set(model, bucket)
  }
  if (!seen.size && !credits.size) return degrade('workbuddy.db 里没有记录模型')
  const list = [...seen.values()].sort((a, b) => {
    const left = credits.get(a.model)?.credits || 0
    const right = credits.get(b.model)?.credits || 0
    return right - left || b.sessions - a.sessions || a.model.localeCompare(b.model, 'zh')
  })
  return {
    ok: true,
    headline: list.length
      ? '本机记录到 ' + list.length + ' 个模型，下面是它们在本地会话里消耗的 credits。'
      : '本机没有记录到模型。',
    note: 'WorkBuddy 的 credit_json 以请求 ID 为键，不是模型名，所以 credits 是按会话最后一次使用的模型归集的；中途换模型会算到最后一个模型上。本地没有每次生成的耗时，所以显示无耗时。',
    models: list.map((item) => {
      const spent = credits.get(item.model)
      const last = item.lastAt ? new Date(item.lastAt).toLocaleDateString('zh-CN') : '时间未知'
      return {
        name: item.model,
        vendor: '',
        status: 0,
        statusText: '本地记录',
        detail: item.sessions + ' 个会话 · 最近 ' + last
          + (spent ? ' · 归集 ' + creditAmount(spent.credits) + ' credits' : ' · 本机没有 credits 记录'),
        speed: null,
      }
    }),
  }
}

export function models() {
  const found = discover()
  if (!found.installed) return found
  return modelsFromRows(readUsageRows(), readSessionRows())
}

function chatName(session) {
  const raw = String(session?.customTitle || '').trim() || String(session?.title || '').trim()
  return raw.replace(/\s+/g, ' ').slice(0, 80) || '未命名对话'
}

function workspaceName(cwd) {
  const parts = String(cwd || '').split(/[/\\]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

// No context samples over time exist locally, so compression is never measured.
export function chatsFromRows(rows, sessions, warnPercent = CONTEXT_WARN_PERCENT) {
  const byId = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session.id) byId.set(session.id, session)
  }
  const list = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.size || !row.used) continue
    const session = byId.get(row.sessionId)
    const percent = Math.round((row.used / row.size) * 1000) / 10
    list.push({
      id: row.sessionId,
      name: chatName(session),
      model: String(session?.model || '').trim() || '未知模型',
      used: row.used,
      limit: row.size,
      percent,
      updatedAt: row.updatedAt,
      createdAt: Number(session?.createdAt) || 0,
      workspace: workspaceName(session?.cwd),
      credits: round2(parseCredits(row.creditJson).credits),
      measured: false,
      compactions: null,
      lostRatio: null,
      growth: null,
      warn: percent >= warnPercent,
    })
  }
  return list.sort((a, b) => b.percent - a.percent)
}

export async function chats(onProgress = () => {}) {
  const found = discover()
  if (!found.installed) return found
  const started = Date.now()
  const report = (done, total, label) => {
    const elapsed = Date.now() - started
    const etaMs = done > 0 ? Math.round((elapsed / done) * Math.max(0, total - done)) : 1500
    onProgress({ done, total, label, etaMs })
  }
  report(0, 2, '对话列表')
  const rows = readUsageRows()
  const sessions = readSessionRows()
  report(1, 2, '对话列表')
  const context = {
    ok: true,
    source: 'workbuddy',
    warnPercent: CONTEXT_WARN_PERCENT,
    note: '上下文比例是 session_usage 里最后一次记录的 used / size。本地没有按时间的采样，所以压缩次数和增幅都不测。',
    chats: chatsFromRows(rows, sessions),
  }
  const store = snapshot()
  store.workbuddy = store.workbuddy || {}
  store.workbuddy.context = context
  persistSnapshot()
  report(2, 2, '对话列表')
  return context
}

export function headers() {
  const found = discover()
  if (!found.installed) return found
  return {
    ok: true,
    chats: readSessionRows().map((session) => ({
      id: session.id,
      name: chatName(session),
      createdAt: Number(session.createdAt) || 0,
    })),
  }
}

export function prompts(kind, chat) {
  const allowed = ['new', 'handoff', 'inherit', 'crash']
  if (!allowed.includes(kind)) return degrade('没有这种提示词')
  return { ok: true, kind, text: renderPrompt(promptProfile, kind, chat || null) }
}

async function copyToClipboard(value) {
  await new Promise((resolve, reject) => {
    const child = spawnProcess('pbcopy')
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('复制失败'))))
    child.stdin.end(value)
  })
}

// WorkBuddy exposes workbuddy://chat/<id> but nothing that writes the input
// box, so the text only ever reaches the clipboard.
export async function paste({ text } = {}) {
  const value = String(text || '').slice(0, 8000)
  if (!value.trim()) return { ok: false, copied: false, error: '没有可粘贴的内容' }
  try {
    await copyToClipboard(value)
  } catch {
    return { ok: false, copied: false, error: '没能写入剪贴板' }
  }
  const reason = 'WorkBuddy 没有写入输入框的本地接口，提示词已复制到剪贴板，请切到 WorkBuddy 手动粘贴。'
  return { ok: false, copied: true, degraded: true, reason, error: reason }
}

export async function spawn({ text, workspace } = {}) {
  const value = String(text || '').trim()
  let copied = false
  if (value) {
    try {
      await copyToClipboard(value.slice(0, 8000))
      copied = true
    } catch { /* clipboard is best effort */ }
  }
  const reason = 'WorkBuddy 没有带提示词开新对话的 URL scheme 或命令行。本地接口只能创建空会话，'
    + '而 /chat/<会话> 会立刻执行一轮并消耗额度，所以不开新对话。'
    + (copied ? '继承提示词已复制到剪贴板，可以手动开新对话粘贴。' : '')
  return { ok: false, spawned: false, copied, degraded: true, reason, error: reason }
}

export function workbuddyChatUrl(chatId) {
  return `workbuddy://chat/${encodeURIComponent(String(chatId || ''))}`
}

export async function open({ chatId, phase = 'arm' } = {}) {
  if (phase === 'done') return { ok: true }
  const value = String(chatId || '')
  if (!/^[0-9a-f-]{32,36}$/i.test(value)) return { ok: false, error: '对话编号无效' }
  try {
    await execFileAsync('open', ['-g', workbuddyChatUrl(value)], { timeout: 8000 })
  } catch {
    return { ok: false, error: '没能打开 WorkBuddy 里的这条对话' }
  }
  return { ok: true, ticket: 1 }
}

export function menu() {
  return degrade('WorkBuddy 的套餐额度在服务端，本地 workbuddy.db 里没有剩余额度记录')
}

export function peekUsage(days) {
  return snapshot().workbuddy?.usage?.[String(Number(days) || 1)] || null
}

export function peekContext() {
  return snapshot().workbuddy?.context || null
}

export function diskTargets() {
  const home = os.homedir()
  const base = path.join(home, 'Library', 'Application Support', 'WorkBuddy')
  return [
    { id: 'workbuddy', label: 'WorkBuddy', path: path.join(home, '.workbuddy'), safe: false, hint: 'workbuddy.db、会话、设置、技能' },
    { id: 'workbuddy-gpucache', label: 'WorkBuddy GPUCache', path: path.join(base, 'GPUCache'), safe: true, hint: 'GPU 缓存' },
    { id: 'workbuddy-dawngraphite', label: 'WorkBuddy DawnGraphiteCache', path: path.join(base, 'DawnGraphiteCache'), safe: true, hint: '图形缓存' },
    { id: 'workbuddy-dawnwebgpu', label: 'WorkBuddy DawnWebGPUCache', path: path.join(base, 'DawnWebGPUCache'), safe: true, hint: 'WebGPU 缓存' },
    { id: 'workbuddy-cache', label: 'WorkBuddy Cache', path: path.join(base, 'Cache'), safe: true, hint: '磁盘缓存' },
    { id: 'workbuddy-codecache', label: 'WorkBuddy Code Cache', path: path.join(base, 'Code Cache'), safe: true, hint: '代码缓存' },
    { id: 'workbuddy-logs', label: 'WorkBuddy logs', path: path.join(base, 'logs'), safe: true, hint: '日志' },
  ]
}

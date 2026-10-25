import { execFile, spawn as spawnProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { CONTEXT_WARN_PERCENT, contextTrend } from '../context.mjs'
import { degrade } from '../degrade.mjs'
import { renderPrompt } from '../prompts.mjs'
import { persistSnapshot, snapshot } from '../snapshot.mjs'

export { CONTEXT_WARN_PERCENT, contextSave, contextTrend } from '../context.mjs'

const execFileAsync = promisify(execFile)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
const DEFAULT_WINDOW = 200_000
const LARGE_WINDOW = 1_000_000
const RECENT_SESSIONS = 60
const HOT_LIMIT = 12
const DESKTOP_ONLY = 'Claude 桌面版的聊天用量不在本地。装了 Claude Code 后这里才有数据。'

export const id = 'claude'
export const name = 'Claude'

// open / spawn are implemented below, but the current UI would run Cursor's
// focus bridge on row click and needs placed:true before spawning. Keep them
// off until CONTRACT-REQUESTS.md is resolved.
export const capabilities = {
  discover: true,
  usage: true,
  models: true,
  chats: true,
  prompts: true,
  disk: true,
  menu: false,
  actions: { open: false, paste: false, spawn: false },
}

export const promptProfile = {
  product: 'Claude Code',
  instructionsFile: 'CLAUDE.md',
  compactCommand: '/compact',
  hasContext: true,
  warnPercent: CONTEXT_WARN_PERCENT,
}

// ---------- paths and discovery ----------

export function paths(home = os.homedir(), env = process.env) {
  const claudeDir = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude')
  return {
    home,
    claudeDir,
    projectsDir: path.join(claudeDir, 'projects'),
    apps: ['/Applications/Claude.app', path.join(home, 'Applications', 'Claude.app')],
    support: path.join(home, 'Library', 'Application Support', 'Claude'),
    caches: path.join(home, 'Library', 'Caches', 'com.anthropic.claudefordesktop'),
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

export function discoverAt(where) {
  const code = isDir(where.projectsDir)
  const app = where.apps.find(isDir) || ''
  return { code, desktop: Boolean(app), app }
}

function tilde(target, home = os.homedir()) {
  const value = String(target || '')
  return value === home || value.startsWith(home + path.sep) ? '~' + value.slice(home.length) : value
}

export function discover() {
  const where = paths()
  const found = discoverAt(where)
  if (!found.code && !found.desktop) return { ...degrade('没有安装 Claude Code 或 Claude 桌面版'), installed: false }
  const sources = []
  if (found.code) sources.push('claude-code')
  if (found.desktop) sources.push('claude-desktop')
  return { ok: true, installed: true, home: tilde(found.code ? where.claudeDir : found.app), sources }
}

function needCode() {
  const found = discoverAt(paths())
  if (found.code) return null
  if (found.desktop) return degrade(DESKTOP_ONLY)
  return { ...degrade('没有安装 Claude Code 或 Claude 桌面版'), installed: false }
}

export function diskTargets() {
  const where = paths()
  return [
    { id: 'claude-home', label: 'Claude Code', path: where.claudeDir, safe: false, hint: '会话记录、设置、技能和插件' },
    { id: 'claude', label: 'Claude 桌面版', path: where.support, safe: false, hint: '桌面版设置和本地数据' },
    { id: 'claude-cache', label: 'Claude Cache', path: path.join(where.support, 'Cache'), safe: true },
    { id: 'claude-codecache', label: 'Claude Code Cache', path: path.join(where.support, 'Code Cache'), safe: true },
    { id: 'claude-gpu', label: 'Claude GPUCache', path: path.join(where.support, 'GPUCache'), safe: true },
    { id: 'claude-dawn', label: 'Claude DawnGraphiteCache', path: path.join(where.support, 'DawnGraphiteCache'), safe: true },
    { id: 'claude-updates', label: 'Claude 更新缓存', path: where.caches, safe: true, hint: '更新下载，会重新下载' },
  ]
}

// ---------- jsonl reading ----------

export function parseLine(text) {
  if (!text || text.charCodeAt(0) !== 123) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function timeOf(entry) {
  const at = Date.parse(entry?.timestamp)
  return Number.isFinite(at) ? at : 0
}

/** One billed assistant message, or null. Streaming writes the same message.id on several lines. */
export function usageOf(entry) {
  if (!entry || entry.type !== 'assistant') return null
  const message = entry.message
  const raw = message && message.usage
  if (!raw || typeof raw !== 'object') return null
  const model = String(message.model || '')
  if (!model || model === '<synthetic>') return null
  const key = String(message.id || entry.uuid || '')
  if (!key) return null
  const item = {
    key,
    model,
    at: timeOf(entry),
    sidechain: Boolean(entry.isSidechain),
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cacheWrite: num(raw.cache_creation_input_tokens),
    cacheRead: num(raw.cache_read_input_tokens),
  }
  item.context = item.input + item.cacheWrite + item.cacheRead
  return item
}

function readSlice(file, start, length) {
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, start)
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function headLines(file, size, bytes = 65_536) {
  const length = Math.min(size, bytes)
  const lines = readSlice(file, 0, length).split('\n')
  if (length < size) lines.pop()
  return lines
}

function tailLines(file, size, bytes = 262_144) {
  const start = Math.max(0, size - bytes)
  const lines = readSlice(file, start, size - start).split('\n')
  if (start > 0) lines.shift()
  return lines
}

function allLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
}

/** Every .jsonl under dir touched since `since` (sessions and subagent transcripts). */
export function listJsonl(dir, since = 0, depth = 0, out = []) {
  if (depth > 5) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listJsonl(full, since, depth + 1, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(full)
        if (stat.mtimeMs >= since) out.push({ file: full, mtimeMs: stat.mtimeMs, size: stat.size })
      } catch { /* vanished */ }
    }
  }
  return out
}

const fileCache = new Map()

/** Billed messages in one transcript, cached by mtime and size. */
export function fileUsage(item) {
  const hit = fileCache.get(item.file)
  if (hit && hit.mtimeMs === item.mtimeMs && hit.size === item.size) return hit.items
  const items = []
  let lines = []
  try {
    lines = allLines(item.file)
  } catch { /* unreadable file counts as empty */ }
  for (const line of lines) {
    if (!line.includes('"usage"')) continue
    const usage = usageOf(parseLine(line))
    if (usage) items.push(usage)
  }
  fileCache.set(item.file, { mtimeMs: item.mtimeMs, size: item.size, items })
  if (fileCache.size > 4000) fileCache.delete(fileCache.keys().next().value)
  return items
}

/** Dedupe across files (resumed sessions replay earlier messages) and keep the most complete line. */
export function createTally(start) {
  const seen = new Map()
  return {
    add(usage) {
      if (!usage || usage.at < start) return
      const previous = seen.get(usage.key)
      if (!previous || usage.output > previous.output) seen.set(usage.key, usage)
    },
    result() {
      const models = new Map()
      for (const usage of seen.values()) {
        const bucket = models.get(usage.model) || { model: usage.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, tokens: 0 }
        bucket.input += usage.input
        bucket.output += usage.output
        bucket.cacheRead += usage.cacheRead
        bucket.cacheWrite += usage.cacheWrite
        bucket.calls += 1
        bucket.tokens = bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite
        models.set(usage.model, bucket)
      }
      const rows = [...models.values()].sort((a, b) => b.tokens - a.tokens)
      return {
        tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
        calls: rows.reduce((sum, row) => sum + row.calls, 0),
        models: rows,
      }
    },
  }
}

export function tallyFiles(files, start) {
  const tally = createTally(start)
  for (const item of files) for (const usage of fileUsage(item)) tally.add(usage)
  return tally.result()
}

function rangeStart(days) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (Math.max(1, Number(days) || 1) - 1))
  return date.getTime()
}

function normalDays(days) {
  const value = Number(days)
  return [1, 7, 30].includes(value) ? value : 1
}

function store() {
  const all = snapshot()
  all.claude = all.claude || {}
  return all.claude
}

// ---------- usage ----------

export function peekUsage(days) {
  return snapshot().claude?.usage?.[String(normalDays(days))] || null
}

export async function usage(days = 1, onProgress = () => {}) {
  const blocked = needCode()
  if (blocked) return blocked
  const span = normalDays(days)
  const start = rangeStart(span)
  const files = listJsonl(paths().projectsDir, start)
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0) || 1
  const started = Date.now()
  let doneBytes = 0
  const tally = createTally(start)
  onProgress({ done: 0, total: files.length, label: '会话记录', etaMs: 3000 })
  for (const [index, item] of files.entries()) {
    for (const usageItem of fileUsage(item)) tally.add(usageItem)
    doneBytes += item.size
    if (index % 10 === 9 || index === files.length - 1) {
      const elapsed = Date.now() - started
      onProgress({
        done: index + 1,
        total: files.length,
        label: '第 ' + (index + 1) + ' / ' + files.length + ' 个会话文件',
        etaMs: Math.round((elapsed / doneBytes) * Math.max(0, totalBytes - doneBytes)),
      })
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  const result = { ok: true, source: 'claude', unit: 'token', days: span, truncated: false, ...tally.result() }
  const saved = store()
  saved.usage = saved.usage || {}
  saved.usage[String(span)] = result
  persistSnapshot()
  return result
}

// ---------- models ----------

export function modelsFromUsage(result, days) {
  const rows = (result && result.models) || []
  if (!rows.length) return degrade('最近 ' + days + ' 天的 Claude Code 会话里没有用到模型')
  return {
    ok: true,
    external: false,
    headline: '本机 Claude Code 最近 ' + days + ' 天用过的模型。',
    note: '本地日志只记录用过哪个模型和多少 token，没有模型目录和服务状态，所以状态写「无状态」。日志里没有生成耗时，速度显示为无耗时。',
    models: rows.map((row) => ({
      name: row.model,
      vendor: /^claude/i.test(row.model) ? 'Anthropic' : '',
      status: 0,
      statusText: '无状态',
      detail: row.calls + ' 次调用 · ' + compactNumber(row.tokens) + ' token',
      speed: null,
    })),
  }
}

function compactNumber(value) {
  const n = Number(value) || 0
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

/** Synchronous: the server sends models() without awaiting. */
export function models() {
  const blocked = needCode()
  if (blocked) return blocked
  for (const days of [30, 7, 1]) {
    const cached = peekUsage(days)
    if (cached && cached.ok) return modelsFromUsage(cached, days)
  }
  try {
    const start = rangeStart(7)
    return modelsFromUsage(tallyFiles(listJsonl(paths().projectsDir, start), start), 7)
  } catch {
    return degrade('读不到 Claude Code 的会话记录')
  }
}

// ---------- sessions ----------

export function listSessionFiles(projectsDir, limit = RECENT_SESSIONS) {
  const out = []
  let projects = []
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const dir = path.join(projectsDir, project.name)
    let files = []
    try {
      files = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const file of files) {
      const match = file.isFile() && SESSION_FILE.exec(file.name)
      if (!match) continue
      const full = path.join(dir, file.name)
      try {
        const stat = fs.statSync(full)
        out.push({ id: match[1].toLowerCase(), file: full, mtimeMs: stat.mtimeMs, size: stat.size })
      } catch { /* vanished */ }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

function promptText(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return ''
  const content = entry.message && entry.message.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const block = content.find((item) => item && item.type === 'text' && typeof item.text === 'string')
    text = block ? block.text : ''
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (!text || /^<(command|local-command|system-reminder)/.test(text) || text.startsWith('Caveat:')) return ''
  return text.slice(0, 80)
}

function titleOf(entry) {
  if (!entry) return ''
  if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') return entry.customTitle
  if (entry.type === 'summary' && typeof entry.summary === 'string') return entry.summary
  return ''
}

export function windowFor(model, maxUsed) {
  return /\b1m\b|\[1m\]/i.test(String(model || '')) || maxUsed > DEFAULT_WINDOW ? LARGE_WINDOW : DEFAULT_WINDOW
}

/** Head and tail only: name, project, model and the latest context size. */
export function sessionMeta(item) {
  const head = headLines(item.file, item.size).map(parseLine).filter(Boolean)
  let tail = item.size > 262_144 ? tailLines(item.file, item.size).map(parseLine).filter(Boolean) : head
  let last = null
  const scan = (entries) => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const usage = usageOf(entries[index])
      if (usage && !usage.sidechain) return usage
    }
    return null
  }
  last = scan(tail)
  if (!last && item.size > 262_144) {
    tail = allLines(item.file).map(parseLine).filter(Boolean)
    last = scan(tail)
  }
  let cwd = ''
  let createdAt = 0
  let firstPrompt = ''
  let title = ''
  for (const entry of head) {
    if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd
    if (!createdAt) createdAt = timeOf(entry)
    if (!firstPrompt) firstPrompt = promptText(entry)
    title = titleOf(entry) || title
  }
  for (const entry of tail) title = titleOf(entry) || title
  let updatedAt = 0
  for (let index = tail.length - 1; index >= 0 && !updatedAt; index -= 1) updatedAt = timeOf(tail[index])
  const used = last ? last.context : 0
  const limit = windowFor(last && last.model, used)
  return {
    id: item.id,
    name: String(title || firstPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    model: (last && last.model) || '未知模型',
    used,
    limit,
    percent: limit ? Math.round((used / limit) * 1000) / 10 : 0,
    updatedAt: updatedAt || Math.round(item.mtimeMs),
    createdAt,
    workspace: cwd ? path.basename(cwd) : '',
    workspacePath: cwd ? tilde(cwd) : '',
  }
}

/** Full read for one session: main-chain context samples and explicit compaction records. */
export function sessionTrend(item) {
  const byKey = new Map()
  const boundaries = []
  for (const line of allLines(item.file)) {
    if (!line.includes('"usage"') && !line.includes('compact_boundary')) continue
    const entry = parseLine(line)
    if (!entry) continue
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      boundaries.push({ at: timeOf(entry), pre: num(entry.compactMetadata && entry.compactMetadata.preTokens) })
      continue
    }
    const usage = usageOf(entry)
    if (!usage || usage.sidechain) continue
    const previous = byKey.get(usage.key)
    if (!previous || usage.output > previous.output) byKey.set(usage.key, usage)
  }
  const samples = [...byKey.values()].map((usage) => ({ at: usage.at, used: usage.context })).sort((a, b) => a.at - b.at)
  const trend = contextTrend(samples)
  const maxUsed = samples.reduce((max, sample) => Math.max(max, sample.used), 0)
  if (!boundaries.length) return { ...trend, maxUsed, samples: samples.length, boundaries: 0 }
  const losses = []
  for (const boundary of boundaries) {
    const next = samples.find((sample) => sample.at >= boundary.at)
    if (boundary.pre > 0 && next && next.used < boundary.pre) losses.push((boundary.pre - next.used) / boundary.pre)
  }
  return {
    compactions: boundaries.length,
    lostRatio: losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : trend.lostRatio,
    growth: trend.growth,
    maxUsed,
    samples: samples.length,
    boundaries: boundaries.length,
  }
}

export function peekContext() {
  return snapshot().claude?.context || null
}

export async function chats(onProgress = () => {}) {
  const blocked = needCode()
  if (blocked) return blocked
  const started = Date.now()
  const report = (done, total, label) => {
    const elapsed = Date.now() - started
    onProgress({ done, total, label, etaMs: done > 0 ? Math.round((elapsed / done) * Math.max(0, total - done)) : 4000 })
  }
  report(0, 1, '对话列表')
  const files = listSessionFiles(paths().projectsDir)
  const list = []
  for (const item of files) {
    try {
      const meta = sessionMeta(item)
      if (meta.used > 0) list.push({ ...meta, file: item.file, size: item.size, mtimeMs: item.mtimeMs })
    } catch { /* skip unreadable session */ }
  }
  list.sort((a, b) => b.percent - a.percent)
  const hot = list.filter((chat) => chat.percent >= CONTEXT_WARN_PERCENT).slice(0, HOT_LIMIT)
  const total = hot.length + 1
  report(1, total, '对话列表')
  const saved = store()
  const savedTrends = saved.trends || {}
  const trends = new Map()
  for (const [index, chat] of hot.entries()) {
    report(index + 1, total, chat.name || '对话')
    const previous = savedTrends[chat.id]
    if (previous && previous.updatedAt === chat.updatedAt) trends.set(chat.id, previous)
    else {
      try {
        const trend = sessionTrend(chat)
        const kept = { updatedAt: chat.updatedAt, compactions: trend.compactions, lostRatio: trend.lostRatio, growth: trend.growth, maxUsed: trend.maxUsed }
        savedTrends[chat.id] = kept
        trends.set(chat.id, kept)
      } catch { /* leave unmeasured */ }
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  saved.trends = savedTrends
  const context = {
    ok: true,
    warnPercent: CONTEXT_WARN_PERCENT,
    chats: list.map(({ file, size, mtimeMs, ...chat }) => {
      const trend = trends.get(chat.id)
      const measured = Boolean(trend)
      let { limit, percent } = chat
      if (measured && trend.maxUsed > limit) {
        limit = windowFor(chat.model, trend.maxUsed)
        percent = Math.round((chat.used / limit) * 1000) / 10
      }
      return {
        ...chat,
        limit,
        percent,
        measured,
        compactions: measured ? trend.compactions : 0,
        lostRatio: measured ? (trend.lostRatio ?? 0) : null,
        growth: measured ? trend.growth : null,
        warn: percent >= CONTEXT_WARN_PERCENT,
      }
    }),
  }
  saved.context = context
  persistSnapshot()
  return context
}

/** Synchronous: the server sends headers() without awaiting. */
export function headers() {
  const blocked = needCode()
  if (blocked) return blocked
  const rows = []
  for (const item of listSessionFiles(paths().projectsDir, 50)) {
    try {
      const head = headLines(item.file, item.size).map(parseLine).filter(Boolean)
      let createdAt = 0
      let title = ''
      let first = ''
      for (const entry of head) {
        if (!createdAt) createdAt = timeOf(entry)
        if (!first) first = promptText(entry)
        title = titleOf(entry) || title
      }
      rows.push({ id: item.id, createdAt: createdAt || Math.round(item.mtimeMs), name: String(title || first).slice(0, 80) })
    } catch { /* skip */ }
  }
  return { ok: true, chats: rows }
}

// ---------- prompts ----------

export function activeProfile(found = discoverAt(paths())) {
  if (found.code) return promptProfile
  return { ...promptProfile, product: 'Claude', compactCommand: '', hasContext: false }
}

export function prompts(kind, chat) {
  if (!['new', 'handoff', 'inherit', 'crash'].includes(kind)) return degrade('没有这种提示词')
  return { ok: true, kind, text: renderPrompt(activeProfile(), kind, chat || null) }
}

// ---------- actions ----------

/** ANSI-C quoting keeps a multi-line prompt on one Terminal line. */
export function shellQuote(value) {
  return "$'" + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') + "'"
}

function expandHome(target, home = os.homedir()) {
  const value = String(target || '')
  if (value === '~') return home
  return value.startsWith('~/') ? path.join(home, value.slice(2)) : value
}

export function resumeCommand({ chatId, cwd }) {
  if (!UUID.test(String(chatId || ''))) throw new Error('对话编号无效')
  if (!cwd) throw new Error('找不到这条对话的项目目录')
  return 'cd ' + shellQuote(cwd) + ' && claude --resume ' + String(chatId).toLowerCase()
}

export function newChatCommand({ text, cwd }) {
  const value = String(text || '').trim().slice(0, 8000)
  if (!value) throw new Error('没有可放入新对话的内容')
  if (!cwd) throw new Error('找不到原项目目录')
  return 'cd ' + shellQuote(cwd) + ' && claude ' + shellQuote(value)
}

/** osascript argv: the command is passed as an argument, never spliced into AppleScript source. */
export function terminalArgs(command) {
  return [
    '-e', 'on run argv',
    '-e', 'tell application "Terminal"',
    '-e', 'activate',
    '-e', 'do script (item 1 of argv)',
    '-e', 'end tell',
    '-e', 'end run',
    command,
  ]
}

function findSession(chatId) {
  const want = String(chatId || '').toLowerCase()
  if (!UUID.test(want)) return null
  let projects = []
  try {
    projects = fs.readdirSync(paths().projectsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const file = path.join(paths().projectsDir, project.name, want + '.jsonl')
    try {
      const stat = fs.statSync(file)
      return { id: want, file, mtimeMs: stat.mtimeMs, size: stat.size }
    } catch { /* not here */ }
  }
  return null
}

function cwdOf(item) {
  for (const entry of headLines(item.file, item.size).map(parseLine).filter(Boolean)) {
    if (typeof entry.cwd === 'string' && entry.cwd) return entry.cwd
  }
  return ''
}

/** spawn() only gets the basename the UI shows; map it back to a full path when it is unique. */
export function resolveWorkspace(workspace, sessions = listSessionFiles(paths().projectsDir, 200)) {
  const value = String(workspace || '').trim()
  if (!value) return ''
  if (value.startsWith('/') || value.startsWith('~')) return expandHome(value)
  const matches = new Set()
  for (const item of sessions) {
    try {
      const cwd = cwdOf(item)
      if (cwd && path.basename(cwd) === value) matches.add(cwd)
    } catch { /* skip */ }
  }
  return matches.size === 1 ? [...matches][0] : ''
}

async function runInTerminal(command) {
  if (process.platform !== 'darwin') return { ok: false, error: '只支持 macOS 的终端' }
  try {
    await execFileAsync('osascript', terminalArgs(command), { timeout: 8000 })
    return { ok: true }
  } catch {
    return { ok: false, error: '没能打开终端。请允许 QuotaPot 控制「终端」。' }
  }
}

function copyText(value) {
  if (process.platform !== 'darwin') return Promise.reject(new Error('只支持 macOS'))
  return new Promise((resolve, reject) => {
    const child = spawnProcess('pbcopy')
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('复制失败'))))
    child.stdin.end(value)
  })
}

/** Claude has no way to fill its input box from outside. Copy only, never Cmd+V. */
export async function paste({ text } = {}) {
  const value = String(text || '').slice(0, 8000)
  if (!value.trim()) return { ok: false, copied: false, error: '没有可复制的内容' }
  try {
    await copyText(value)
  } catch {
    return { ok: false, copied: false, error: '复制失败' }
  }
  return { ok: true, copied: true, placed: false, note: 'Claude 没有从外部写入输入框的接口。已复制，请手动粘贴。' }
}

export async function spawn({ text, workspace } = {}) {
  const cwd = resolveWorkspace(workspace)
  if (!cwd) return { ok: false, error: workspace ? '找不到项目「' + workspace + '」的完整路径' : '没有原项目目录' }
  let command
  try {
    command = newChatCommand({ text, cwd })
  } catch (error) {
    return { ok: false, error: error.message }
  }
  const ran = await runInTerminal(command)
  return ran.ok ? { ok: true, spawned: true, workspace: path.basename(cwd) } : ran
}

export async function open({ chatId, phase } = {}) {
  if (phase === 'done') return { ok: true }
  const item = findSession(chatId)
  if (!item) return { ok: false, error: '没找到这条对话' }
  let command
  try {
    command = resumeCommand({ chatId: item.id, cwd: cwdOf(item) })
  } catch (error) {
    return { ok: false, error: error.message }
  }
  const ran = await runInTerminal(command)
  return ran.ok ? { ok: true, ticket: 0 } : ran
}

// ---------- menu ----------

export function menu() {
  return degrade('Claude 没有本地额度接口。订阅额度只在 Claude 应用和 claude.ai 里显示。')
}

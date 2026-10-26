import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { spawn as spawnProcess } from 'node:child_process'
import { CONTEXT_WARN_PERCENT } from '../context.mjs'
import { degrade } from '../degrade.mjs'
import { renderPrompt } from '../prompts.mjs'

export const id = 'codex'
export const name = 'Codex'
export const capabilities = {
  discover: true, usage: true, models: true, chats: true,
  prompts: true, disk: true, menu: true,
  actions: { open: false, paste: false, spawn: false },
}
export const promptProfile = {
  product: 'Codex', instructionsFile: 'AGENTS.md', compactCommand: '/compact',
  hasContext: true, warnPercent: CONTEXT_WARN_PERCENT,
}

const validId = (value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value || ''))
const count = (value) => Number.isSafeInteger(value) && value >= 0
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const sessionsRoot = () => path.join(os.homedir(), '.codex', 'sessions')
const usageSnapshots = new Map()
const fileCache = new Map()
let contextSnapshot = null

export function discover() {
  if (!fs.existsSync(sessionsRoot())) return { ...degrade('没有找到 ~/.codex/sessions 会话目录'), installed: false }
  return { ok: true, installed: true, home: '~/.codex' }
}

function tokenUsage(raw) {
  const keys = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']
  if (!raw || !keys.every((key) => count(raw[key]))) return null
  if (raw.cached_input_tokens > raw.input_tokens || raw.reasoning_output_tokens > raw.output_tokens) return null
  return Object.fromEntries(keys.map((key) => [key, raw[key]]))
}

function newRollout() {
  return {
    id: null, workspace: '', model: '未知模型', vendor: '', createdAt: null, updatedAt: null,
    events: [], samples: 0, compactions: null, context: null, limits: null,
    previous: null, incomplete: false,
  }
}

function consume(rollout, line) {
  // Ignore message bodies, tools and embedded media before parsing; retain only telemetry.
  if (!['session_meta', 'turn_context', 'token_count', 'compacted'].some((key) => line.includes(key))) return
  let event
  try { event = JSON.parse(line) } catch { rollout.incomplete = true; return }
  const payload = event?.payload
  if (!payload || typeof payload !== 'object') return
  const at = timestamp(event.timestamp)
  if (event.type === 'session_meta') {
    const sessionId = payload.id || payload.session_id
    if (validId(sessionId)) rollout.id = sessionId
    if (typeof payload.cwd === 'string') rollout.workspace = payload.cwd
    rollout.vendor = typeof payload.model_provider === 'string' ? payload.model_provider : ''
    rollout.createdAt = timestamp(payload.timestamp) ?? at
  } else if (event.type === 'turn_context') {
    if (typeof payload.model === 'string' && payload.model) rollout.model = payload.model
  } else if (event.type === 'compacted') {
    rollout.compactions = (rollout.compactions ?? 0) + 1
  } else if (event.type === 'event_msg' && payload.type === 'token_count') {
    const limits = payload.rate_limits
    // Reserve pools are distinct quotas, even when they also have a seven-day window.
    if (at !== null && limits && (!limits.limit_id || limits.limit_id === 'codex') && (!rollout.limits || at >= rollout.limits.at)) {
      rollout.limits = { at, primary: limits.primary, secondary: limits.secondary }
    }
    const info = payload.info
    if (!info) return
    const last = tokenUsage(info.last_token_usage)
    if (last && at !== null && (!rollout.context || at >= rollout.context.at)) {
      rollout.context = {
        at, used: last.total_tokens,
        limit: count(info.model_context_window) && info.model_context_window > 0 ? info.model_context_window : null,
      }
    }
    const current = tokenUsage(info.total_token_usage)
    if (!current) { rollout.incomplete = true; return }
    const previous = rollout.previous
    const reset = previous && current.total_tokens < previous.total_tokens
    // A resumed/inherited first counter can already contain earlier usage. Count only its last sample.
    const initial = last && last.total_tokens <= current.total_tokens ? last : current
    const delta = !previous || reset ? initial : Object.fromEntries(Object.keys(current).map((key) => [key, current[key] - previous[key]]))
    if ((!previous || reset) && current.total_tokens > delta.total_tokens) rollout.incomplete = true
    rollout.previous = current
    if (at === null || Object.values(delta).some((value) => value < 0)) { rollout.incomplete = true; return }
    rollout.samples += 1
    if (delta.total_tokens > 0) rollout.events.push({ at, model: rollout.model, ...delta })
  } else return
  if (at !== null) rollout.updatedAt = Math.max(rollout.updatedAt ?? at, at)
}

export function parseRollout(text) {
  const rollout = newRollout()
  for (const line of String(text).split(/\r?\n/)) consume(rollout, line)
  return rollout
}

function walk(directory) {
  const files = []
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name)
    if (item.isDirectory()) files.push(...walk(file))
    else if (item.isFile() && item.name.endsWith('.jsonl')) files.push(file)
  }
  return files
}

function readRollout(file) {
  const rollout = newRollout()
  const input = fs.openSync(file, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.alloc(64 * 1024)
  let fragments = []
  try {
    let bytes
    while ((bytes = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
      const text = decoder.write(buffer.subarray(0, bytes))
      let start = 0
      let end
      while ((end = text.indexOf('\n', start)) !== -1) {
        fragments.push(text.slice(start, end))
        consume(rollout, fragments.join(''))
        fragments = []
        start = end + 1
      }
      if (start < text.length) fragments.push(text.slice(start))
    }
    fragments.push(decoder.end())
    if (fragments.length) consume(rollout, fragments.join(''))
  } finally { fs.closeSync(input) }
  return rollout
}

function loadRollouts(onProgress = () => {}) {
  const files = walk(sessionsRoot())
  const rows = []
  const started = Date.now()
  let unreadable = 0
  onProgress({ done: 0, total: files.length, label: 'Codex 会话记录', etaMs: null })
  for (const [index, file] of files.entries()) {
    try {
      const info = fs.statSync(file)
      const stamp = `${info.size}:${info.mtimeMs}`
      let cached = fileCache.get(file)
      if (!cached || cached.stamp !== stamp) {
        cached = { stamp, row: readRollout(file) }
        fileCache.set(file, cached)
      }
      if (cached.row.id) rows.push(cached.row)
      else unreadable += 1
    } catch { unreadable += 1 }
    onProgress({
      done: index + 1, total: files.length, label: 'Codex 会话记录',
      etaMs: Math.round((Date.now() - started) / (index + 1) * (files.length - index - 1)),
    })
  }
  for (const file of fileCache.keys()) if (!files.includes(file)) fileCache.delete(file)
  return { rows, unreadable }
}

export function rangeStart(days, now = Date.now()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - days + 1)
  return date.getTime()
}

function aggregate(rows, start, end) {
  const models = new Map()
  for (const row of rows) for (const event of row.events) {
    if (event.at < start || event.at > end) continue
    const bucket = models.get(event.model) || { model: event.model, input: 0, output: 0, cacheRead: 0, reasoning: 0, calls: 0, tokens: 0 }
    // Codex input includes cached input; output includes reasoning. Count each token once.
    bucket.input += event.input_tokens - event.cached_input_tokens
    bucket.cacheRead += event.cached_input_tokens
    bucket.output += event.output_tokens
    bucket.reasoning += event.reasoning_output_tokens
    bucket.tokens += event.total_tokens
    bucket.calls += 1
    models.set(event.model, bucket)
  }
  const list = [...models.values()].sort((a, b) => b.tokens - a.tokens)
  return { tokens: list.reduce((sum, item) => sum + item.tokens, 0), calls: list.reduce((sum, item) => sum + item.calls, 0), models: list }
}

export function usageFromRollouts(rows, days = 1, now = Date.now(), unreadable = 0) {
  if (![1, 7, 30].includes(days)) return degrade('用量只支持今日、7 天或 30 天')
  const counted = rows.filter((row) => row.samples > 0)
  if (!counted.length) return degrade('没有可核实的 Codex token_count 累计用量；未记录用量的会话不计入，不能视为 0')
  const excluded = rows.length - counted.length
  const note = `仅统计 token_count 累计值的增量；${excluded} 条无可核实用量的会话未计入。原始 input 含缓存、output 含推理，汇总不重复相加；calls 是正增量记录数。${unreadable ? `${unreadable} 个文件无法读取。` : ''}首次或重置累计值带有历史基数时只计最近单次；无法归属时间的历史基数和损坏记录不计入。`
  return {
    ok: true, source: id, unit: 'token', days,
    ...aggregate(counted, rangeStart(days, now), now),
    sessions: counted.length, excludedSessions: excluded,
    truncated: excluded > 0 || unreadable > 0 || rows.some((row) => row.incomplete),
    note, truncatedNote: note,
  }
}

export async function usage(days = 1, onProgress = () => {}) {
  const found = discover()
  if (!found.ok) return found
  if (![1, 7, 30].includes(Number(days))) return degrade('用量只支持今日、7 天或 30 天')
  try {
    const { rows, unreadable } = loadRollouts(onProgress)
    const result = usageFromRollouts(rows, Number(days), Date.now(), unreadable)
    if (result.ok) usageSnapshots.set(result.days, result)
    return result
  } catch { return degrade('无法读取 Codex 会话用量') }
}

export function modelsFromRollouts(rows) {
  const totals = aggregate(rows, -Infinity, Infinity)
  if (!totals.models.length) return degrade('没有带可核实用量的 Codex 模型记录')
  return {
    ok: true, headline: 'Codex 本地会话中记录的模型和用量',
    note: '状态未核实；本地记录不能证明服务实时状态。没有可信的逐次生成耗时，速度显示为无耗时。用量为本地保留记录，非账单。',
    models: totals.models.map((item) => ({
      name: item.model, vendor: rows.find((row) => row.events.some((event) => event.model === item.model))?.vendor || '',
      status: 1, statusText: '未核实', speed: null, unit: 'token', tokens: item.tokens,
      detail: `本地记录 ${item.tokens} token；实时状态未核实；无耗时。`,
    })),
  }
}

export function models() {
  const found = discover()
  if (!found.ok) return found
  try { return modelsFromRollouts(loadRollouts().rows) }
  catch { return degrade('无法读取 Codex 模型记录') }
}

function header(row) {
  return { id: row.id, name: `Codex ${row.id.slice(0, 8)}`, createdAt: row.createdAt }
}

export function chatsFromRollouts(rows) {
  return {
    ok: true, warnPercent: CONTEXT_WARN_PERCENT,
    chats: rows.map((row) => {
      const used = row.context?.used ?? null
      const limit = row.context?.limit ?? null
      const percent = used !== null && limit !== null ? used / limit * 100 : null
      return {
        ...header(row), model: row.model, workspace: row.workspace, updatedAt: row.updatedAt,
        used, limit, percent, warn: percent !== null && percent >= CONTEXT_WARN_PERCENT,
        measured: false, compactions: row.compactions, lostRatio: null, growth: null,
      }
    }).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    note: '一个 rollout 一条会话；80% 只高亮，不过滤。未记录上下文时比例为空；压缩仅计明确的 compacted 事件，丢失率与增幅未测量。',
  }
}

export async function chats(onProgress = () => {}) {
  const found = discover()
  if (!found.ok) return found
  try {
    const { rows, unreadable } = loadRollouts(onProgress)
    contextSnapshot = { ...chatsFromRollouts(rows), truncated: unreadable > 0 }
    return contextSnapshot
  } catch { return degrade('无法读取 Codex 对话记录') }
}

export function headers() {
  const found = discover()
  if (!found.ok) return found
  try { return { ok: true, chats: loadRollouts().rows.map(header) } }
  catch { return degrade('无法读取 Codex 对话标题') }
}

export const peekUsage = (days = 1) => usageSnapshots.get(Number(days)) || null
export const peekContext = () => contextSnapshot

export function prompts(kind, chat) {
  if (!['new', 'handoff', 'inherit', 'crash'].includes(kind)) return degrade('没有这种提示词')
  const hasContext = Number.isFinite(chat?.used) && Number.isFinite(chat?.limit) && chat.limit > 0 && Number.isFinite(chat?.percent)
  // The shared renderer otherwise invents a zero loss ratio for a known compaction count.
  const promptChat = chat && { ...chat, compactions: chat.lostRatio == null ? null : chat.compactions }
  return { ok: true, kind, text: renderPrompt({ ...promptProfile, hasContext }, kind, promptChat) }
}

export function diskTargets() {
  return [{
    id, label: 'Codex 用户数据（只读）', path: path.join(os.homedir(), '.codex'), safe: false,
    hint: '会话、配置、凭据及用户资产；未核实可重建目录，不提供清理目标。',
  }]
}

export function menuFromRollouts(rows, now = Date.now()) {
  const latest = rows.map((row) => row.limits).filter(Boolean).sort((a, b) => b.at - a.at)[0]
  if (!latest) return degrade('没有 Codex rate_limits 窗口百分比记录；这不是 token 用量')
  const windows = [latest.primary, latest.secondary].filter((raw) => raw && typeof raw.used_percent === 'number' && Number.isFinite(raw.used_percent) && raw.used_percent >= 0 && raw.used_percent <= 100)
  const windowOf = (minutes, label) => {
    const raw = windows.find((item) => item.window_minutes === minutes)
    return raw ? { label, usedPercent: raw.used_percent, windowMinutes: minutes, resetsAt: count(raw.resets_at) ? raw.resets_at : null } : null
  }
  const primary = windowOf(300, '5 小时窗口已用百分比')
  const secondary = windowOf(10080, '7 天窗口已用百分比')
  if (!primary && !secondary) return degrade('最近的 Codex rate_limits 未提供可核实的 5 小时或 7 天窗口百分比')
  const chosen = primary || secondary
  const ageMs = Math.max(0, now - latest.at)
  const stale = ageMs > 15 * 60_000 || (chosen.resetsAt !== null && chosen.resetsAt * 1000 <= now)
  return {
    ok: true, unit: 'percent', usedPercent: chosen.usedPercent, label: chosen.label,
    primary, secondary, updatedAt: latest.at, ageMs, stale,
    note: `窗口已用百分比，非 token。记录时间 ${new Date(latest.at).toISOString()}。${stale ? '记录已过时，仅供参考，不能视为当前额度。' : '本地最近快照。'}`,
  }
}

export async function menu() {
  const found = discover()
  if (!found.ok) return found
  try { return menuFromRollouts(loadRollouts().rows) }
  catch { return degrade('无法读取 Codex 窗口百分比') }
}

const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`

export function terminalCommand(kind, { chatId, workspace, text } = {}) {
  if (typeof workspace !== 'string' || !path.posix.isAbsolute(workspace) || workspace.includes('\0')) return { ok: false, error: '没有可核实的原项目绝对路径' }
  let command
  if (kind === 'open') {
    if (!validId(chatId)) return { ok: false, error: '对话编号无效' }
    command = `cd -- ${shellQuote(workspace)} && codex resume ${shellQuote(chatId)}`
  } else if (kind === 'spawn') {
    if (typeof text !== 'string' || !text.trim() || text.includes('\0')) return { ok: false, error: '没有有效的新对话提示词' }
    command = `codex -C ${shellQuote(workspace)} -- ${shellQuote(text)}`
  } else return { ok: false, error: '没有这种 Terminal 命令' }
  const literal = command.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n')
  const script = `tell application "Terminal"\nactivate\ndo script "${literal}"\nend tell`
  return { ok: true, command, terminal: { app: 'Terminal', executable: '/usr/bin/osascript', args: ['-e', script] } }
}

function commandOnly(plan) {
  if (!plan.ok) return plan
  return { ...plan, ok: false, error: '仅生成 Terminal 命令，尚未执行；请自行在系统 Terminal 中运行。' }
}

export function spawn(options = {}) {
  return commandOnly(terminalCommand('spawn', options))
}

export async function open({ chatId, phase = 'arm' } = {}) {
  if (phase !== 'arm') return { ok: false, error: '没有待完成的 Terminal 动作' }
  if (!validId(chatId)) return { ok: false, error: '对话编号无效' }
  const found = discover()
  if (!found.ok) return { ok: false, error: found.reason }
  try {
    const row = loadRollouts().rows.find((item) => item.id === chatId)
    if (!row) return { ok: false, error: '没有找到这条 Codex 会话' }
    return commandOnly(terminalCommand('open', { chatId, workspace: row.workspace }))
  } catch { return { ok: false, error: '无法读取原项目路径' } }
}

export async function paste({ text } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, copied: false, error: '没有可复制的内容' }
  if (process.platform !== 'darwin') return { ok: false, copied: false, error: '只支持 macOS 系统剪贴板' }
  try {
    await new Promise((resolve, reject) => {
      const child = spawnProcess('/usr/bin/pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
      child.once('error', reject)
      child.stdin.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error('复制失败')))
      child.stdin.end(text)
    })
    return { ok: false, copied: true, placed: false, error: '已复制，请手动粘贴到 Codex；不支持放入输入框。' }
  } catch { return { ok: false, copied: false, error: '复制到系统剪贴板失败' } }
}

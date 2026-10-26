#!/usr/bin/env node
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { rm, stat, statfs } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { diskTargets } from './disk.mjs'
import {
  contextSave,
  contextTrend,
  cursorPromptUrl,
  formatTokens,
  modelStatus,
  summarizeCursor,
} from './ports/cursor/index.mjs'
import { degrade } from './ports/degrade.mjs'
import { getPort, installedPorts, ports } from './ports/registry.mjs'

export { diskTargets }
export { contextSave, contextTrend, cursorPromptUrl, formatTokens, modelStatus, summarizeCursor }

const execFileAsync = promisify(execFile)
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const UI = path.join(ROOT, 'ui', 'index.html')
const PORT = Number(process.env.QUOTAPOT_PORT) || 18765
const HOST = '127.0.0.1'
export const VERSION = '0.5.1'
const RELEASES = process.env.QUOTAPOT_RELEASES || 'https://github.com/Caffrey-Li/QuotaPot/releases'

async function walkJsonl(dir, out = []) {
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
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

async function readTail(file, bytes) {
  const handle = await fs.promises.open(file, 'r')
  try {
    const info = await handle.stat()
    const length = Math.min(info.size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, Math.max(0, info.size - length))
    const text = buffer.toString('utf8')
    return info.size > bytes ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await handle.close()
  }
}

function rateLimitsFromText(text) {
  let latest = null
  let latestAt = 0
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('rate_limits')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const payload = event.payload
    const limits = payload && payload.type === 'token_count' ? payload.rate_limits : null
    const at = Date.parse(event.timestamp)
    if (!limits || !Number.isFinite(at) || at < latestAt) continue
    latest = limits
    latestAt = at
  }
  return latest
}

function windowOf(raw) {
  if (!raw) return null
  return {
    usedPercent: Number(raw.used_percent) || 0,
    resetsAt: Number(raw.resets_at) || null,
  }
}

async function codexUsage() {
  const files = await walkJsonl(path.join(os.homedir(), '.codex', 'sessions'))
  if (files.length === 0) return { ok: false, error: '没有 Codex 会话' }
  const ranked = []
  for (const file of files) {
    try {
      const info = await fs.promises.stat(file)
      ranked.push({ file, mtime: info.mtimeMs })
    } catch { /* skip a file that disappears mid-scan */ }
  }
  ranked.sort((a, b) => b.mtime - a.mtime)
  let latest = null
  // ponytail: sessions are 1.4GB; the menu only needs the newest rate limit. Read the tail, not every file.
  for (const item of ranked.slice(0, 3)) {
    latest = rateLimitsFromText(await readTail(item.file, 512 * 1024))
    if (latest) break
  }
  return {
    ok: true,
    sessions: ranked.length,
    limit: latest === null ? null : {
      primary: windowOf(latest.primary),
      secondary: windowOf(latest.secondary),
    },
  }
}

function wrap(result, label) {
  if (result.status === 'fulfilled') return result.value
  return { ok: false, error: `${label}：${String(result.reason && result.reason.message ? result.reason.message : result.reason).slice(0, 200)}` }
}

export async function collectStatus() {
  const cursor = getPort('cursor')
  const [menu, codex] = await Promise.allSettled([
    cursor ? cursor.menu() : Promise.resolve(degrade('没有 Cursor 端口')),
    codexUsage(),
  ])
  return {
    ok: true,
    cursor: wrap(menu, 'Cursor'),
    codex: wrap(codex, 'Codex'),
    updatedAt: Date.now(),
  }
}

function homeOf(target) {
  const home = os.homedir()
  return String(target || '').startsWith(home) ? `~${String(target).slice(home.length)}` : target
}

let lastDisk = null

export async function scanDisk({ fresh = false } = {}) {
  if (!fresh && lastDisk && Date.now() - lastDisk.scannedAt < 60_000) return lastDisk
  return scanDiskProgress(() => {})
}

async function directorySize(targetPath) {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', targetPath], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    const kb = Number.parseInt(String(stdout).split(/\s+/)[0], 10)
    return Number.isFinite(kb) ? kb * 1024 : null
  } catch {
    return null
  }
}

export async function scanDiskProgress(onProgress) {
  const existing = []
  for (const target of diskTargets()) {
    try {
      if ((await stat(target.path)).isDirectory()) existing.push(target)
    } catch { /* folder is absent */ }
  }
  const items = []
  let done = 0
  const started = Date.now()
  const report = (label) => {
    const elapsed = Date.now() - started
    const etaMs = done > 0 ? Math.round((elapsed / done) * Math.max(0, existing.length - done)) : null
    onProgress({ done, total: existing.length, label, etaMs })
  }
  for (const target of existing) {
    report(target.label)
    const size = await directorySize(target.path)
    done += 1
    if (size !== null) items.push({ ...target, path: homeOf(target.path), size })
    report(target.label)
  }
  let free = null
  try {
    const info = await statfs(os.homedir())
    free = info.bavail * info.bsize
  } catch { /* free space is optional */ }
  items.sort((a, b) => b.size - a.size)
  lastDisk = { ok: true, items, free, thresholdGB: 3, scannedAt: Date.now() }
  return lastDisk
}

export function cleanTargets(ids) {
  const known = new Map(diskTargets().map((item) => [item.id, item]))
  const accepted = []
  const rejected = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const target = known.get(String(id))
    if (target) accepted.push(target)
    else rejected.push(String(id))
  }
  return { accepted, rejected }
}

export async function cleanDisk(ids) {
  const { accepted, rejected } = cleanTargets(ids)
  const cleaned = []
  const errors = rejected.map((id) => ({ id, error: 'UNKNOWN' }))
  let freed = 0
  for (const target of accepted) {
    const size = await directorySize(target.path) ?? 0
    try {
      await rm(target.path, { recursive: true, force: true })
      freed += size
      cleaned.push(target.id)
    } catch (error) {
      errors.push({ id: target.id, error: String(error?.message ?? error).slice(0, 160) })
    }
  }
  return { ok: errors.length === 0, freed, cleaned, errors }
}

export function newerVersion(latest, current) {
  const a = String(latest).replace(/^v/, '').split('.').map(Number)
  const b = String(current).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return false
}

let updateCache = { at: 0, data: null }

export async function checkUpdate({ fresh = false } = {}) {
  const ttl = updateCache.data?.ok ? 6 * 3600_000 : 30 * 60_000
  if (!fresh && updateCache.data && Date.now() - updateCache.at < ttl) return updateCache.data
  let data
  try {
    // ponytail: the REST API allows 60 calls/hour per IP and shared proxies exhaust it; the public release pages have no such cap.
    const options = { headers: { 'user-agent': `QuotaPot/${VERSION}` }, signal: AbortSignal.timeout(15_000) }
    const page = await fetch(`${RELEASES}/latest`, options)
    await page.body?.cancel()
    if (!page.ok) throw new Error(`HTTP ${page.status}`)
    const tag = (page.url.match(/\/tag\/([^/?#]+)$/) || [])[1]
    if (!tag) throw new Error('网站上还没有发布的版本')
    const assets = await fetch(`${RELEASES}/expanded_assets/${tag}`, options)
    if (!assets.ok) throw new Error(`HTTP ${assets.status}`)
    const href = ((await assets.text()).match(/href="([^"]*\/releases\/download\/[^"]+\.zip)"/) || [])[1]
    const latest = decodeURIComponent(tag).replace(/^v/, '')
    data = {
      ok: true,
      current: VERSION,
      latest,
      newer: Boolean(href) && newerVersion(latest, VERSION),
      zip: href ? new URL(href, page.url).href : null,
      page: page.url,
    }
  } catch (error) {
    data = { ok: false, current: VERSION, newer: false, error: String(error.message || error).slice(0, 160) }
  }
  updateCache = { at: Date.now(), data }
  return data
}

function findSource(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, 'desktop.mjs'))) return dir
  if (depth >= 2) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__MACOSX') continue
    const found = findSource(path.join(dir, entry.name), depth + 1)
    if (found) return found
  }
  return null
}

/** Swap every top-level entry of src into root; root-only entries (.git, notes) stay. Restores on failure. */
export function replaceFiles(src, root, backup) {
  const names = fs.readdirSync(src).filter((name) => !name.startsWith('.') && name !== '__MACOSX')
  fs.mkdirSync(backup, { recursive: true })
  const saved = []
  try {
    for (const name of names) {
      const target = path.join(root, name)
      if (fs.existsSync(target)) {
        fs.cpSync(target, path.join(backup, name), { recursive: true })
        saved.push(name)
      }
      fs.rmSync(target, { recursive: true, force: true })
      fs.cpSync(path.join(src, name), target, { recursive: true })
    }
  } catch (error) {
    for (const name of names) fs.rmSync(path.join(root, name), { recursive: true, force: true })
    for (const name of saved) fs.cpSync(path.join(backup, name), path.join(root, name), { recursive: true })
    throw error
  }
  return names
}

function quotaPotAppPid() {
  try {
    const comm = execFileSync('/bin/ps', ['-o', 'comm=', '-p', String(process.ppid)], { encoding: 'utf8' }).trim()
    return comm.endsWith('/MacOS/QuotaPot') ? process.ppid : null
  } catch {
    return null
  }
}

let updating = false

export async function installUpdate() {
  if (updating) return { ok: false, error: '正在更新，请稍候' }
  updating = true
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'quotapot-update-'))
  try {
    const info = await checkUpdate({ fresh: true })
    if (!info.ok) return { ok: false, error: `连不上更新服务器：${info.error}` }
    if (!info.newer) return { ok: false, error: '已经是最新版本' }
    const response = await fetch(info.zip, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) return { ok: false, error: `下载失败：HTTP ${response.status}` }
    const zip = path.join(work, 'update.zip')
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()))
    const unpacked = path.join(work, 'unpacked')
    execFileSync('/usr/bin/ditto', ['-x', '-k', zip, unpacked])
    const src = findSource(unpacked)
    if (!src) return { ok: false, error: '下载的压缩包里没有 QuotaPot 程序' }
    const check = spawnSync(process.execPath, [path.join(src, 'desktop.mjs'), '--check'], { cwd: src, encoding: 'utf8', timeout: 120_000 })
    if (check.status !== 0 || !String(check.stdout).includes('quotapot self-check ok')) return { ok: false, error: '新版本自检没有通过，已保留当前版本' }
    const swift = (dir) => {
      try {
        return fs.readFileSync(path.join(dir, 'native', 'Window.swift'), 'utf8')
      } catch {
        return ''
      }
    }
    const rebuild = swift(src) !== swift(ROOT)
    const backup = path.join(work, 'backup')
    replaceFiles(src, ROOT, backup)
    if (rebuild) {
      const build = spawnSync(process.execPath, [path.join(ROOT, 'desktop.mjs'), '--build'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
      if (build.status !== 0) {
        replaceFiles(backup, ROOT, path.join(work, 'discard'))
        return { ok: false, error: '新版本安装失败，已还原到当前版本' }
      }
    }
    const appPid = quotaPotAppPid()
    const restart = `sleep 1; ${appPid ? `kill ${appPid}; sleep 1; ` : ''}open ${JSON.stringify(appDir())}`
    const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir() }
    spawn('/bin/sh', ['-c', restart], { detached: true, stdio: 'ignore', env }).unref()
    setTimeout(() => process.exit(0), 300)
    return { ok: true, version: info.latest, rebuilt: rebuild }
  } catch (error) {
    return { ok: false, error: `更新失败：${String(error.message || error).slice(0, 160)}` }
  } finally {
    updating = false
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 64_000) {
        reject(new Error('BODY_TOO_LARGE'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function openSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  return (event) => response.write(`data: ${JSON.stringify(event)}\n\n`)
}

async function routePort(request, response, url) {
  const match = url.pathname.match(/^\/api\/ports(?:\/([a-z0-9-]+))?(\/.*)?$/)
  if (!match) return false
  if (!match[1]) {
    sendJson(response, 200, { ok: true, ports: installedPorts() })
    return true
  }
  const port = getPort(match[1])
  if (!port) {
    sendJson(response, 404, degrade('没有这个端口'))
    return true
  }
  const sub = match[2] || ''
  try {
    if (request.method === 'GET' && sub === '/usage/stream') {
      const send = openSse(response)
      const cached = port.peekUsage(url.searchParams.get('days'))
      if (cached) send({ type: 'cached', usage: cached })
      const result = await port.usage(url.searchParams.get('days'), (progress) => send({ type: 'progress', ...progress }))
      send({ type: 'done', usage: result })
      response.end()
      return true
    }
    if (request.method === 'GET' && sub === '/models') {
      sendJson(response, 200, port.models())
      return true
    }
    if (request.method === 'GET' && sub === '/context/stream') {
      const send = openSse(response)
      const cached = port.peekContext()
      if (cached) send({ type: 'cached', context: cached })
      const result = await port.chats((progress) => send({ type: 'progress', ...progress }))
      send({ type: 'done', context: result })
      response.end()
      return true
    }
    if (request.method === 'GET' && sub === '/headers') {
      sendJson(response, 200, port.headers())
      return true
    }
    if (request.method === 'POST' && sub === '/prompts') {
      const body = await readBody(request)
      sendJson(response, 200, port.prompts(body.kind, body.chat))
      return true
    }
    if (request.method === 'POST' && sub === '/paste') {
      const body = await readBody(request)
      sendJson(response, 200, await port.paste({ text: body.text, chatId: body.chatId }))
      return true
    }
    if (request.method === 'POST' && sub === '/spawn') {
      const body = await readBody(request)
      sendJson(response, 200, await port.spawn(body))
      return true
    }
    if (request.method === 'POST' && sub === '/open') {
      const body = await readBody(request)
      sendJson(response, 200, await port.open({ chatId: body.chatId, phase: body.phase, ticket: body.ticket }))
      return true
    }
  } catch (error) {
    if (!response.headersSent) sendJson(response, 500, degrade(String(error.message || error)))
    else response.end()
    return true
  }
  return false
}

function serve() {
  const html = fs.readFileSync(UI)
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(html)
      return
    }
    if (await routePort(request, response, url)) return
    if (request.method === 'GET' && url.pathname === '/api/status') {
      try {
        sendJson(response, 200, await collectStatus())
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error.message || error) })
      }
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/update') {
      sendJson(response, 200, await checkUpdate({ fresh: url.searchParams.get('fresh') === '1' }))
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/update/install') {
      sendJson(response, 200, await installUpdate())
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/disk/stream') {
      const send = openSse(response)
      try {
        const disk = await scanDiskProgress((progress) => send({ type: 'progress', ...progress }))
        send({ type: 'done', disk })
      } catch (error) {
        send({ type: 'error', error: String(error.message || error) })
      }
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/disk') {
      try {
        sendJson(response, 200, await scanDisk({ fresh: url.searchParams.get('fresh') === '1' }))
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error.message || error) })
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/disk/clean') {
      try {
        const body = await readBody(request)
        sendJson(response, 200, await cleanDisk(body.ids))
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error.message || error) })
      }
      return
    }
    response.writeHead(404)
    response.end()
  })
  server.listen(PORT, HOST, () => {
    process.stdout.write(`QUOTAPOT_LISTEN ${HOST}:${PORT}\n`)
    if (process.platform === 'win32' && !process.env.QUOTAPOT_NO_WINDOW) openDesktopWindow()
  })
}

function browserApp() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean)
  return candidates.find((file) => fs.existsSync(file)) || null
}

export function openDesktopWindow() {
  const url = `http://${HOST}:${PORT}/`
  const bin = browserApp()
  if (!bin) {
    process.stdout.write(`请用浏览器打开 ${url}\n`)
    return
  }
  const profile = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'QuotaPot', 'window')
  spawn(bin, [`--app=${url}`, '--window-size=400,680', `--user-data-dir=${profile}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()
}

function findNode() {
  if (process.execPath && fs.existsSync(process.execPath)) return process.execPath
  return 'node'
}

function appDir() {
  const system = '/Applications/QuotaPot.app'
  try {
    fs.accessSync('/Applications', fs.constants.W_OK)
    return system
  } catch {
    return path.join(os.homedir(), 'Applications', 'QuotaPot.app')
  }
}

function installWindows() {
  const dest = path.join(os.homedir(), 'Desktop', 'QuotaPot.cmd')
  const body = `@echo off\r\n"${findNode()}" "${path.join(ROOT, 'desktop.mjs')}"\r\n`
  fs.writeFileSync(dest, body)
  process.stdout.write(`installed ${dest}\n`)
  return dest
}

function install() {
  if (process.platform === 'win32') return installWindows()
  const dest = appDir()
  const macos = path.join(dest, 'Contents', 'MacOS')
  const resources = path.join(dest, 'Contents', 'Resources')
  fs.mkdirSync(macos, { recursive: true })
  fs.mkdirSync(resources, { recursive: true })
  const binary = path.join(macos, 'QuotaPot')
  execFileSync('/usr/bin/swiftc', [
    '-O', '-parse-as-library',
    path.join(ROOT, 'native', 'Window.swift'),
    '-o', binary,
    '-framework', 'Cocoa',
    '-framework', 'WebKit',
    '-framework', 'ApplicationServices',
  ], { stdio: 'inherit' })
  fs.writeFileSync(path.join(resources, 'plugin-root.txt'), ROOT)
  fs.writeFileSync(path.join(resources, 'node-path.txt'), findNode())
  const icon = path.join(ROOT, 'native', 'AppIcon.icns')
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(resources, 'AppIcon.icns'))
  fs.writeFileSync(path.join(dest, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>QuotaPot</string>
  <key>CFBundleIdentifier</key><string>dev.quotapot.desktop</string>
  <key>CFBundleName</key><string>QuotaPot</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
`)
  process.stdout.write(`installed ${dest}\n`)
  return dest
}

function selfCheck() {
  const summary = summarizeCursor({
    planUsage: { limit: 2000, includedSpend: 500, remaining: 1500, totalPercentUsed: 25 },
  }, 'Pro')
  if (summary.usedPercent !== 25 || summary.remainingCents !== 1500 || summary.planName !== 'Pro' || summary.unit !== 'percent') {
    throw new Error(`summarizeCursor failed: ${JSON.stringify(summary)}`)
  }
  const derived = summarizeCursor({ planUsage: { limit: 1000, includedSpend: 250 } })
  if (derived.remainingCents !== 750 || derived.usedPercent !== 25) {
    throw new Error(`derived percent failed: ${JSON.stringify(derived)}`)
  }
  if (formatTokens(1500) !== '1.5K') throw new Error(`formatTokens failed: ${formatTokens(1500)}`)
  if (!newerVersion('v0.10.0', '0.9.9') || newerVersion('0.5.0', '0.5.0') || newerVersion('0.4.9', '0.5.0')) {
    throw new Error('version compare drifted')
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quotapot-check-'))
  const [src, root] = [path.join(tmp, 'src'), path.join(tmp, 'root')]
  fs.mkdirSync(path.join(src, 'ports', 'a'), { recursive: true })
  fs.mkdirSync(path.join(root, 'ports', 'old'), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(src, 'desktop.mjs'), 'new')
  fs.writeFileSync(path.join(root, 'desktop.mjs'), 'old')
  fs.writeFileSync(path.join(root, 'notes.md'), 'keep')
  replaceFiles(src, root, path.join(tmp, 'backup'))
  const replaced = fs.readFileSync(path.join(root, 'desktop.mjs'), 'utf8') === 'new'
    && fs.existsSync(path.join(root, 'ports', 'a')) && !fs.existsSync(path.join(root, 'ports', 'old'))
    && fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, 'notes.md'))
    && fs.readFileSync(path.join(tmp, 'backup', 'desktop.mjs'), 'utf8') === 'old'
  fs.rmSync(tmp, { recursive: true, force: true })
  if (!replaced) throw new Error('update file swap drifted')
  const targets = diskTargets()
  const byId = new Map(targets.map((item) => [item.id, item]))
  if (byId.get('cursor')?.safe !== false || byId.get('cursor-cache')?.safe !== true) {
    throw new Error('disk safety flags drifted')
  }
  const winCursor = diskTargets('win32', {
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  }, 'C:\\Users\\me').find((item) => item.id === 'cursor')
  if (!winCursor || winCursor.safe !== false || !winCursor.path.endsWith('\\Cursor')) {
    throw new Error('windows disk paths drifted')
  }
  const plan = cleanTargets(['cursor', 'cursor-cache', '../etc'])
  if (plan.accepted.map((item) => item.id).join(',') !== 'cursor,cursor-cache' || plan.rejected[0] !== '../etc') {
    throw new Error('threshold must not decide what can be cleaned')
  }
  const trend = contextTrend([
    { at: 1, used: 100 },
    { at: 2, used: 180 },
    { at: 3, used: 40 },
    { at: 4, used: 90 },
  ])
  if (/^[0-9a-f-]{36}$/i.test('not-an-id')) throw new Error('open chat id check is wrong')
  const promptUrl = cursorPromptUrl('交接', 'demo')
  if (!promptUrl.startsWith('cursor://anysphere.cursor-deeplink/prompt?') || !promptUrl.includes('workspace=demo')) {
    throw new Error('new chat link is wrong')
  }
  if (trend.compactions !== 1 || Math.abs(trend.lostRatio - (140 / 180)) > 0.001 || Math.abs(trend.growth + 0.1) > 0.001) {
    throw new Error(`context trend failed: ${JSON.stringify(trend)}`)
  }
  if (/from '\//.test(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'))) {
    throw new Error('desktop.mjs imports a file outside the project')
  }
  const html = fs.readFileSync(UI, 'utf8')
  if (html.includes('quotapot_status')) throw new Error('UI still exposes the MCP tool')
  if (modelStatus(1).statusText !== '降级' || modelStatus(2).statusText !== '停用' || modelStatus(0).detail) {
    throw new Error('model status text drifted')
  }
  for (const label of ['用量', '模型', '对话', '空间', '工具', '阈值', '上下文消耗增幅', '整理', '一键整理', '继承对话', '一键开新', '耗时', '崩溃', '无耗时']) {
    if (!html.includes(label)) throw new Error(`UI missing ${label}`)
  }
  if (html.includes('data-tab="balance"') || html.includes('data-tab="agents"')) {
    throw new Error('UI still has balance or agents tabs')
  }
  if (!html.includes('quotapot.diskThresholdGB') || !html.includes('80%')) {
    throw new Error('UI drifted from the context threshold')
  }
  if (contextSave(0.8 * 256000) < 100000) throw new Error('80% context no longer pays back a tidy')
  if (contextSave(0.5 * 256000) >= 100000) throw new Error('threshold is below the measured payback')
  if (html.includes('class="sea"') || html.includes('class="whale"')) {
    throw new Error('UI still has the window whale')
  }
  if (!html.includes('row-sheen') || !html.includes('/api/ports/')) {
    throw new Error('chat rows cannot open or highlight')
  }
  for (const port of ports) {
    const check = path.join(ROOT, 'ports', port.id, 'check.mjs')
    const result = spawnSync(process.execPath, [check], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`${port.id} check failed`)
  }
  console.log('quotapot self-check ok')
}

const args = process.argv.slice(2)
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
if (isMain && args.includes('--check')) selfCheck()
else if (isMain && args.includes('--build')) install()
else if (isMain && args.includes('--install')) {
  const dest = install()
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', dest], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  else spawn('open', [dest], { detached: true, stdio: 'ignore' }).unref()
} else if (isMain) {
  serve()
}

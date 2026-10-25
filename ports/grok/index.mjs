import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { degrade } from '../degrade.mjs'
import { renderPrompt } from '../prompts.mjs'

export const id = 'grok'
export const name = 'Grok Bot'

export const capabilities = {
  discover: true,
  usage: false,
  models: false,
  chats: false,
  prompts: true,
  disk: true,
  menu: false,
  actions: { open: false, paste: false, spawn: false },
}

export const promptProfile = {
  product: 'Grok Bot',
  instructionsFile: 'AGENTS.md',
  compactCommand: '',
  hasContext: false,
  warnPercent: 80,
}

const APP_NAME = 'Grok Bot.app'
const DATA_DIR_NAME = 'Grok Bot'
const BUNDLE_ID = 'com.anysphere.sand'

function homeOf(target) {
  const home = os.homedir()
  const value = String(target || '')
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value
}

/** Absolute path to the macOS app bundle. */
export function appPath() {
  return path.join('/Applications', APP_NAME)
}

/** Absolute path to Application Support user data. */
export function dataPath() {
  return path.join(os.homedir(), 'Library', 'Application Support', DATA_DIR_NAME)
}

/**
 * Pure helper for fixtures / check.mjs: decide discover result from path existence flags.
 * @param {{ appExists: boolean, dataExists?: boolean, app?: string, data?: string }} info
 */
export function discoverFromPaths(info = {}) {
  const app = info.app || '/Applications/Grok Bot.app'
  const data = info.data || '~/Library/Application Support/Grok Bot'
  if (!info.appExists) {
    return { ...degrade('没有安装 Grok Bot'), installed: false }
  }
  const home = info.dataExists ? data : app.replace(/^\/Users\/[^/]+/, '~')
  // Prefer tilde form when callers already pass placeholders.
  const homeOut = String(home).startsWith('/Users/')
    ? home.replace(/^\/Users\/[^/]+/, '~')
    : home
  return { ok: true, installed: true, home: homeOut }
}

export function discover() {
  const app = appPath()
  try {
    if (!fs.statSync(app).isDirectory()) {
      return { ...degrade('没有安装 Grok Bot'), installed: false }
    }
  } catch {
    return { ...degrade('没有安装 Grok Bot'), installed: false }
  }
  const data = dataPath()
  try {
    if (fs.statSync(data).isDirectory()) {
      return { ok: true, installed: true, home: homeOf(data) }
    }
  } catch { /* fall through to app path */ }
  return { ok: true, installed: true, home: homeOf(app) }
}

export function usage() {
  return degrade('Grok Bot 在云端运行，本机没有用量数据')
}

export function models() {
  return degrade('本机没有 Grok Bot 的模型目录')
}

export function chats() {
  return degrade('对话在云端，本机没有上下文数据')
}

export function headers() {
  return degrade('对话在云端，本机没有对话列表')
}

export function menu() {
  return degrade('本机读不到 Grok Bot 的额度')
}

export function prompts(kind, chat) {
  const allowed = ['new', 'handoff', 'inherit', 'crash']
  if (!allowed.includes(kind)) return degrade('没有这种提示词')
  return { ok: true, kind, text: renderPrompt(promptProfile, kind, chat || null) }
}

export async function paste() {
  return { ok: false, error: '本端口不支持写入 Grok Bot 输入框，请手动复制提示词粘贴' }
}

export async function spawn() {
  return { ok: false, error: '本端口不支持带提示词开新 Grok Bot 对话' }
}

export async function open() {
  return { ok: false, error: '本端口不支持打开 Grok Bot 对话，深链见 CONTRACT-REQUESTS.md' }
}

export function diskTargets() {
  const support = dataPath()
  const libraryCaches = path.join(os.homedir(), 'Library', 'Caches', BUNDLE_ID)
  const shipIt = path.join(os.homedir(), 'Library', 'Caches', BUNDLE_ID + '.ShipIt')
  return [
    {
      id: 'grok',
      label: 'Grok Bot data',
      path: support,
      safe: false,
      hint: 'settings, client state, cookies, sand-client-persistence — do not clear casually',
    },
    { id: 'grok-cache', label: 'Grok Bot Cache', path: path.join(support, 'Cache'), safe: true },
    { id: 'grok-codecache', label: 'Grok Bot Code Cache', path: path.join(support, 'Code Cache'), safe: true },
    { id: 'grok-gpucache', label: 'Grok Bot GPUCache', path: path.join(support, 'GPUCache'), safe: true },
    { id: 'grok-dawn-graphite', label: 'Grok Bot DawnGraphiteCache', path: path.join(support, 'DawnGraphiteCache'), safe: true },
    { id: 'grok-dawn-webgpu', label: 'Grok Bot DawnWebGPUCache', path: path.join(support, 'DawnWebGPUCache'), safe: true },
    { id: 'grok-library-cache', label: 'Grok Bot Library Caches', path: libraryCaches, safe: true },
    { id: 'grok-shipit-cache', label: 'Grok Bot ShipIt cache', path: shipIt, safe: true },
  ]
}

export function peekUsage() {
  return null
}

export function peekContext() {
  return null
}

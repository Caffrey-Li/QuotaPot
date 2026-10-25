import os from 'node:os'
import path from 'node:path'

const home = os.homedir()
const APP_SUPPORT = path.join(home, 'Library', 'Application Support')
const CACHE_DIR = path.join(home, 'Library', 'Caches')
const DSH_HOME = process.env.DSH_HOME || path.join(home, '.dsh')

/** Known AI tool directories, macOS paths. The id map is what cleanDisk trusts. */
export function diskTargets() {
  return [
    { id: 'dsh', label: 'DSH / DS Bot data', path: DSH_HOME, safe: false, hint: 'sessions, bot data, workspace' },
    { id: 'playwright', label: 'Playwright browsers', path: path.join(CACHE_DIR, 'ms-playwright'), safe: true, hint: 're-downloaded when needed' },
    { id: 'cursor', label: 'Cursor', path: path.join(APP_SUPPORT, 'Cursor'), safe: false, hint: 'chats, settings, snapshots' },
    { id: 'cursor-cacheddata', label: 'Cursor CachedData', path: path.join(APP_SUPPORT, 'Cursor', 'CachedData'), safe: true },
    { id: 'cursor-cache', label: 'Cursor Cache', path: path.join(APP_SUPPORT, 'Cursor', 'Cache'), safe: true },
    { id: 'cursor-codecache', label: 'Cursor Code Cache', path: path.join(APP_SUPPORT, 'Cursor', 'Code Cache'), safe: true },
    { id: 'cursor-gpucache', label: 'Cursor GPUCache', path: path.join(APP_SUPPORT, 'Cursor', 'GPUCache'), safe: true },
    { id: 'cursor-logs', label: 'Cursor logs', path: path.join(APP_SUPPORT, 'Cursor', 'logs'), safe: true },
    { id: 'npm', label: 'npm cache', path: path.join(home, '.npm', '_cacache'), safe: true },
    { id: 'pnpm', label: 'pnpm store', path: path.join(home, 'Library', 'pnpm', 'store'), safe: true, hint: 'rebuilt on demand' },
    { id: 'hf', label: 'HuggingFace cache', path: path.join(home, '.cache', 'huggingface'), safe: true, hint: 'models re-download' },
    { id: 'ollama', label: 'Ollama models', path: path.join(home, '.ollama'), safe: false, hint: 'models must be pulled again' },
    { id: 'chatgpt', label: 'ChatGPT data', path: path.join(APP_SUPPORT, 'ChatGPT'), safe: false },
    { id: 'codex', label: 'Codex data', path: path.join(home, '.codex'), safe: false },
    { id: 'workbuddy', label: 'WorkBuddy', path: path.join(home, '.workbuddy'), safe: false, hint: 'sessions, workspaces, credits db' },
    { id: 'workbuddy-gpu', label: 'WorkBuddy GPUCache', path: path.join(APP_SUPPORT, 'WorkBuddy', 'GPUCache'), safe: true },
    { id: 'workbuddy-dawn', label: 'WorkBuddy DawnGraphiteCache', path: path.join(APP_SUPPORT, 'WorkBuddy', 'DawnGraphiteCache'), safe: true },
    { id: 'workbuddy-cache', label: 'WorkBuddy Cache', path: path.join(APP_SUPPORT, 'WorkBuddy', 'Cache'), safe: true },
    { id: 'workbuddy-codecache', label: 'WorkBuddy Code Cache', path: path.join(APP_SUPPORT, 'WorkBuddy', 'Code Cache'), safe: true },
    { id: 'zcode', label: 'ZCode', path: path.join(home, '.zcode'), safe: false, hint: 'tasks, plan, credentials' },
    { id: 'zcode-gpu', label: 'ZCode GPUCache', path: path.join(APP_SUPPORT, 'ZCode', 'GPUCache'), safe: true },
    { id: 'zcode-cache', label: 'ZCode Cache', path: path.join(APP_SUPPORT, 'ZCode', 'Cache'), safe: true },
    { id: 'claude-home', label: 'Claude home', path: path.join(home, '.claude'), safe: false, hint: 'Claude Code skills/sessions' },
    { id: 'claude', label: 'Claude desktop', path: path.join(APP_SUPPORT, 'Claude'), safe: false, hint: 'desktop data; no local token usage' },
    { id: 'claude-gpu', label: 'Claude GPUCache', path: path.join(APP_SUPPORT, 'Claude', 'GPUCache'), safe: true },
    { id: 'claude-dawn', label: 'Claude DawnGraphiteCache', path: path.join(APP_SUPPORT, 'Claude', 'DawnGraphiteCache'), safe: true },
    { id: 'claude-cache', label: 'Claude Cache', path: path.join(APP_SUPPORT, 'Claude', 'Cache'), safe: true },
    { id: 'trae', label: 'Trae', path: path.join(APP_SUPPORT, 'Trae'), safe: false, hint: 'Trae editor data' },
    { id: 'trae-solo', label: 'Trae Solo', path: path.join(APP_SUPPORT, 'TRAE SOLO CN'), safe: false, hint: 'Trae Solo editor data' },
  ]
}

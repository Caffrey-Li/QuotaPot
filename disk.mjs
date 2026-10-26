import os from 'node:os'
import path from 'node:path'

/** Known AI tool directories. The id map is what cleanDisk trusts. */
export function diskTargets(platform = process.platform, env = process.env, home = os.homedir()) {
  const p = platform === 'win32' ? path.win32 : path
  const roam = platform === 'win32'
    ? (env.APPDATA || p.join(home, 'AppData', 'Roaming'))
    : p.join(home, 'Library', 'Application Support')
  const local = platform === 'win32'
    ? (env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'))
    : p.join(home, 'Library', 'Caches')
  const dsh = env.DSH_HOME || p.join(home, '.dsh')
  const pnpm = platform === 'win32' ? p.join(local, 'pnpm', 'store') : p.join(home, 'Library', 'pnpm', 'store')
  const npm = platform === 'win32' ? p.join(local, 'npm-cache') : p.join(home, '.npm', '_cacache')
  return [
    { id: 'dsh', label: 'DSH / DS Bot data', path: dsh, safe: false, hint: 'sessions, bot data, workspace' },
    { id: 'playwright', label: 'Playwright browsers', path: p.join(local, 'ms-playwright'), safe: true, hint: 're-downloaded when needed' },
    { id: 'cursor', label: 'Cursor', path: p.join(roam, 'Cursor'), safe: false, hint: 'chats, settings, snapshots' },
    { id: 'cursor-cacheddata', label: 'Cursor CachedData', path: p.join(roam, 'Cursor', 'CachedData'), safe: true },
    { id: 'cursor-cache', label: 'Cursor Cache', path: p.join(roam, 'Cursor', 'Cache'), safe: true },
    { id: 'cursor-codecache', label: 'Cursor Code Cache', path: p.join(roam, 'Cursor', 'Code Cache'), safe: true },
    { id: 'cursor-gpucache', label: 'Cursor GPUCache', path: p.join(roam, 'Cursor', 'GPUCache'), safe: true },
    { id: 'cursor-logs', label: 'Cursor logs', path: p.join(roam, 'Cursor', 'logs'), safe: true },
    { id: 'npm', label: 'npm cache', path: npm, safe: true },
    { id: 'pnpm', label: 'pnpm store', path: pnpm, safe: true, hint: 'rebuilt on demand' },
    { id: 'hf', label: 'HuggingFace cache', path: p.join(home, '.cache', 'huggingface'), safe: true, hint: 'models re-download' },
    { id: 'ollama', label: 'Ollama models', path: p.join(home, '.ollama'), safe: false, hint: 'models must be pulled again' },
    { id: 'chatgpt', label: 'ChatGPT data', path: p.join(roam, 'ChatGPT'), safe: false },
    { id: 'codex', label: 'Codex data', path: p.join(home, '.codex'), safe: false },
    { id: 'workbuddy', label: 'WorkBuddy', path: p.join(home, '.workbuddy'), safe: false, hint: 'sessions, workspaces, credits db' },
    { id: 'workbuddy-gpu', label: 'WorkBuddy GPUCache', path: p.join(roam, 'WorkBuddy', 'GPUCache'), safe: true },
    { id: 'workbuddy-dawn', label: 'WorkBuddy DawnGraphiteCache', path: p.join(roam, 'WorkBuddy', 'DawnGraphiteCache'), safe: true },
    { id: 'workbuddy-cache', label: 'WorkBuddy Cache', path: p.join(roam, 'WorkBuddy', 'Cache'), safe: true },
    { id: 'workbuddy-codecache', label: 'WorkBuddy Code Cache', path: p.join(roam, 'WorkBuddy', 'Code Cache'), safe: true },
    { id: 'zcode', label: 'ZCode', path: p.join(home, '.zcode'), safe: false, hint: 'tasks, plan, credentials' },
    { id: 'zcode-gpu', label: 'ZCode GPUCache', path: p.join(roam, 'ZCode', 'GPUCache'), safe: true },
    { id: 'zcode-cache', label: 'ZCode Cache', path: p.join(roam, 'ZCode', 'Cache'), safe: true },
    { id: 'claude-home', label: 'Claude home', path: p.join(home, '.claude'), safe: false, hint: 'Claude Code skills/sessions' },
    { id: 'claude', label: 'Claude desktop', path: p.join(roam, 'Claude'), safe: false, hint: 'desktop data; no local token usage' },
    { id: 'claude-gpu', label: 'Claude GPUCache', path: p.join(roam, 'Claude', 'GPUCache'), safe: true },
    { id: 'claude-dawn', label: 'Claude DawnGraphiteCache', path: p.join(roam, 'Claude', 'DawnGraphiteCache'), safe: true },
    { id: 'claude-cache', label: 'Claude Cache', path: p.join(roam, 'Claude', 'Cache'), safe: true },
    { id: 'trae', label: 'Trae', path: p.join(roam, 'Trae'), safe: false, hint: 'Trae editor data' },
    { id: 'trae-solo', label: 'Trae Solo', path: p.join(roam, 'TRAE SOLO CN'), safe: false, hint: 'Trae Solo editor data' },
  ]
}

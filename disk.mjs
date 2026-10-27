import os from 'node:os'
import path from 'node:path'

/**
 * One machine-wide list of AI tool directories, grouped by tool. The space page is not per port.
 * The id map is what cleanDisk trusts. A target nested inside another target of the same group
 * is shown as its child, and its size is already part of the parent.
 * Paths marked "verified" were checked on a real Mac by the port that reads that tool.
 */
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
  const cursor = p.join(roam, 'Cursor')
  const claude = p.join(roam, 'Claude')
  const workbuddy = p.join(roam, 'WorkBuddy')
  const grok = p.join(roam, 'Grok Bot')
  return [
    { id: 'cursor', group: 'Cursor', label: 'Cursor 用户数据', path: cursor, safe: false, hint: '对话、设置、快照' },
    { id: 'cursor-cacheddata', group: 'Cursor', label: 'CachedData', path: p.join(cursor, 'CachedData'), safe: true },
    { id: 'cursor-cache', group: 'Cursor', label: 'Cache', path: p.join(cursor, 'Cache'), safe: true },
    { id: 'cursor-codecache', group: 'Cursor', label: 'Code Cache', path: p.join(cursor, 'Code Cache'), safe: true },
    { id: 'cursor-gpucache', group: 'Cursor', label: 'GPUCache', path: p.join(cursor, 'GPUCache'), safe: true },
    { id: 'cursor-logs', group: 'Cursor', label: '日志', path: p.join(cursor, 'logs'), safe: true },

    { id: 'claude-home', group: 'Claude', label: 'Claude Code 用户数据', path: p.join(home, '.claude'), safe: false, hint: '会话记录、设置、技能' },
    { id: 'claude', group: 'Claude', label: 'Claude 桌面版数据', path: claude, safe: false, hint: '桌面版设置和本地数据' },
    { id: 'claude-cache', group: 'Claude', label: 'Cache', path: p.join(claude, 'Cache'), safe: true },
    { id: 'claude-codecache', group: 'Claude', label: 'Code Cache', path: p.join(claude, 'Code Cache'), safe: true },
    { id: 'claude-gpu', group: 'Claude', label: 'GPUCache', path: p.join(claude, 'GPUCache'), safe: true },
    { id: 'claude-dawn', group: 'Claude', label: 'DawnGraphiteCache', path: p.join(claude, 'DawnGraphiteCache'), safe: true },

    { id: 'codex', group: 'Codex', label: 'Codex 用户数据', path: p.join(home, '.codex'), safe: false, hint: '会话、配置、凭据' },

    // verified by the DS Bot port
    { id: 'dsh', group: 'DS Bot', label: 'DS Bot 用户数据', path: dsh, safe: false, hint: '会话、Bot 数据、工作区' },
    { id: 'dsh-cache', group: 'DS Bot', label: 'cache', path: p.join(dsh, 'cache'), safe: true },
    { id: 'dsh-projcache', group: 'DS Bot', label: '会话项目缓存', path: p.join(dsh, 'storages', 'session_projcache'), safe: true },
    { id: 'dsh-logs', group: 'DS Bot', label: '日志', path: p.join(dsh, 'logs'), safe: true },
    { id: 'dsh-attachments-tmp', group: 'DS Bot', label: '附件临时文件', path: p.join(dsh, 'attachments', 'v1', 'tmp'), safe: true },

    // verified by the WorkBuddy port
    { id: 'workbuddy', group: 'WorkBuddy', label: 'WorkBuddy 用户数据', path: p.join(home, '.workbuddy'), safe: false, hint: '会话、工作区、积分数据库' },
    { id: 'workbuddy-gpu', group: 'WorkBuddy', label: 'GPUCache', path: p.join(workbuddy, 'GPUCache'), safe: true },
    { id: 'workbuddy-dawn', group: 'WorkBuddy', label: 'DawnGraphiteCache', path: p.join(workbuddy, 'DawnGraphiteCache'), safe: true },
    { id: 'workbuddy-dawnwebgpu', group: 'WorkBuddy', label: 'DawnWebGPUCache', path: p.join(workbuddy, 'DawnWebGPUCache'), safe: true },
    { id: 'workbuddy-cache', group: 'WorkBuddy', label: 'Cache', path: p.join(workbuddy, 'Cache'), safe: true },
    { id: 'workbuddy-codecache', group: 'WorkBuddy', label: 'Code Cache', path: p.join(workbuddy, 'Code Cache'), safe: true },
    { id: 'workbuddy-logs', group: 'WorkBuddy', label: '日志', path: p.join(workbuddy, 'logs'), safe: true },

    // verified on a real Mac when Grok Bot was evaluated as a port
    { id: 'grok', group: 'Grok Bot', label: 'Grok Bot 用户数据', path: grok, safe: false, hint: '设置、登录状态' },
    { id: 'grok-cache', group: 'Grok Bot', label: 'Cache', path: p.join(grok, 'Cache'), safe: true },
    { id: 'grok-codecache', group: 'Grok Bot', label: 'Code Cache', path: p.join(grok, 'Code Cache'), safe: true },
    { id: 'grok-gpucache', group: 'Grok Bot', label: 'GPUCache', path: p.join(grok, 'GPUCache'), safe: true },
    { id: 'grok-dawn-graphite', group: 'Grok Bot', label: 'DawnGraphiteCache', path: p.join(grok, 'DawnGraphiteCache'), safe: true },
    { id: 'grok-dawn-webgpu', group: 'Grok Bot', label: 'DawnWebGPUCache', path: p.join(grok, 'DawnWebGPUCache'), safe: true },
    { id: 'grok-library-cache', group: 'Grok Bot', label: '应用缓存', path: p.join(local, 'com.anysphere.sand'), safe: true },
    { id: 'grok-shipit-cache', group: 'Grok Bot', label: '更新缓存', path: p.join(local, 'com.anysphere.sand.ShipIt'), safe: true },

    { id: 'zcode', group: 'ZCode', label: 'ZCode 用户数据', path: p.join(home, '.zcode'), safe: false, hint: '任务、套餐、凭据' },
    { id: 'zcode-gpu', group: 'ZCode', label: 'GPUCache', path: p.join(roam, 'ZCode', 'GPUCache'), safe: true },
    { id: 'zcode-cache', group: 'ZCode', label: 'Cache', path: p.join(roam, 'ZCode', 'Cache'), safe: true },

    { id: 'trae', group: 'Trae', label: 'Trae 用户数据', path: p.join(roam, 'Trae'), safe: false, hint: '编辑器数据' },
    { id: 'trae-solo', group: 'Trae', label: 'Trae Solo 用户数据', path: p.join(roam, 'TRAE SOLO CN'), safe: false, hint: '编辑器数据' },

    { id: 'chatgpt', group: 'ChatGPT', label: 'ChatGPT 用户数据', path: p.join(roam, 'ChatGPT'), safe: false },

    { id: 'ollama', group: '本地模型', label: 'Ollama 模型', path: p.join(home, '.ollama'), safe: false, hint: '删除后要重新拉取' },
    { id: 'hf', group: '本地模型', label: 'HuggingFace 缓存', path: p.join(home, '.cache', 'huggingface'), safe: true, hint: '用到时会重新下载' },

    { id: 'npm', group: '开发缓存', label: 'npm 缓存', path: npm, safe: true },
    { id: 'pnpm', group: '开发缓存', label: 'pnpm store', path: pnpm, safe: true, hint: '按需重建' },
    { id: 'playwright', group: '开发缓存', label: 'Playwright 浏览器', path: p.join(local, 'ms-playwright'), safe: true, hint: '用到时会重新下载' },
  ]
}

/** True when `inner` is strictly inside `outer`. */
export function isInside(inner, outer) {
  const rel = path.relative(outer, inner)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

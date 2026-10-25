import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  capabilities,
  chats,
  discoverFromPaths,
  diskTargets,
  headers,
  menu,
  models,
  open,
  paste,
  promptProfile,
  prompts,
  spawn,
  usage,
  peekContext,
  peekUsage,
} from './index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(capabilities.discover === true, 'discover capability drifted')
assert(capabilities.usage === false, 'usage capability should be false')
assert(capabilities.models === false, 'models capability should be false')
assert(capabilities.chats === false, 'chats capability should be false')
assert(capabilities.menu === false, 'menu capability should be false')
assert(capabilities.prompts === true, 'prompts capability drifted')
assert(capabilities.disk === true, 'disk capability drifted')
assert(capabilities.actions.open === false && capabilities.actions.paste === false && capabilities.actions.spawn === false, 'actions capability drifted')

assert(promptProfile.product === 'Grok Bot', 'product drifted')
assert(promptProfile.instructionsFile === 'AGENTS.md', 'instructions file drifted')
assert(promptProfile.compactCommand === '', 'compact command drifted')
assert(promptProfile.hasContext === false, 'hasContext should be false')
assert(promptProfile.warnPercent === 80, 'warnPercent drifted')

const paths = fixture('discover-paths.json')
const installed = discoverFromPaths(paths.installed)
assert(installed.ok && installed.installed === true, 'fixture installed discover failed')
assert(installed.home === '~/Library/Application Support/Grok Bot', 'installed home drifted')
const installedNoData = discoverFromPaths(paths.installedNoData)
assert(installedNoData.ok && installedNoData.home === '/Applications/Grok Bot.app', 'installed-without-data home drifted')
const missing = discoverFromPaths(paths.missing)
assert(missing.ok === false && missing.degraded === true && missing.installed === false, 'missing app should degrade')
assert(String(missing.reason).includes('没有安装'), 'missing reason should be Chinese')

const degraded = fixture('degrade-samples.json')
const usageResult = usage()
assert(usageResult.ok === false && usageResult.degraded === true, 'usage should degrade')
assert(usageResult.reason === degraded.usage.reason, 'usage reason drifted')
assert(models().reason === degraded.models.reason && models().degraded, 'models reason drifted')
assert(chats().reason === degraded.chats.reason && chats().degraded, 'chats reason drifted')
assert(headers().reason === degraded.headers.reason && headers().degraded, 'headers reason drifted')
assert(menu().reason === degraded.menu.reason && menu().degraded, 'menu reason drifted')
for (const result of [usageResult, models(), chats(), headers(), menu()]) {
  assert(/[\u4e00-\u9fff]/.test(result.reason), 'degrade reason must be Chinese: ' + result.reason)
}

const chat = fixture('prompts.json').chat
const fresh = prompts('new', null)
assert(fresh.ok && fresh.kind === 'new', 'new prompt failed')
assert(fresh.text.startsWith('这是一次新的 Grok Bot 对话'), 'new prompt opening drifted')
assert(fresh.text.includes('AGENTS.md'), 'new prompt must mention AGENTS.md')

const handoff = prompts('handoff', chat)
assert(handoff.ok && !handoff.text.includes('上下文大约已用'), 'handoff must not include context percent')
assert(!handoff.text.includes('压缩过 0 次'), 'handoff must not invent compaction count')
const handoffEmpty = prompts('handoff', null)
assert(handoffEmpty.ok && !handoffEmpty.text.includes('上下文大约已用'), 'empty handoff must not invent context')
assert(handoffEmpty.text.includes('如果中间做过摘要'), 'handoff lost summary caveat')
assert(!handoffEmpty.text.includes('需要压缩时可以使用'), 'handoff invented a compact command')

const inherit = prompts('inherit', chat)
assert(inherit.ok && !inherit.text.includes('上下文大约已用'), 'inherit must not include context percent')
assert(inherit.text.includes('示例对话'), 'inherit should keep chat name')

const crash = prompts('crash', null)
assert(crash.ok && crash.text.includes('AGENTS.md') && crash.text.includes('崩溃'), 'crash prompt drifted')
assert(prompts('unknown', null).degraded === true, 'unknown prompt kind should degrade')

const disks = diskTargets()
const data = disks.find((item) => item.id === 'grok')
assert(data && data.safe === false, 'grok data must be safe:false')
assert(disks.some((item) => item.safe === true && String(item.id).includes('cache')), 'at least one cache must be safe:true')
assert(disks.every((item) => typeof item.path === 'string' && item.path.length > 0), 'disk paths must be strings')
assert(disks.some((item) => item.id === 'grok-library-cache'), 'library cache target missing')
assert(disks.some((item) => item.id === 'grok-shipit-cache'), 'ShipIt cache target missing')
assert(disks.some((item) => item.id === 'grok-dawn-graphite'), 'DawnGraphite cache missing')
assert(disks.some((item) => item.id === 'grok-dawn-webgpu'), 'DawnWebGPU cache missing')

const diskFixture = fixture('disk-targets.json')
assert(diskFixture.some((item) => item.id === 'grok' && item.safe === false), 'disk fixture data drifted')
assert(diskFixture.some((item) => item.safe === true), 'disk fixture needs a safe cache')
assert(!JSON.stringify(diskFixture).includes('/Users/'), 'disk fixture leaked absolute user path')

assert(peekUsage() === null && peekContext() === null, 'peek helpers should return null')

assert((await paste({ text: 'demo' })).ok === false, 'paste should not succeed')
assert((await spawn({ text: 'demo' })).ok === false, 'spawn should not succeed')
assert((await open({ chatId: 'demo' })).ok === false, 'open should not succeed')

const source = fs.readFileSync(path.join(root, 'index.mjs'), 'utf8')
assert(!source.includes('sqlite3') && !source.includes('python3'), 'grok port must not shell out to sqlite3/python3')
assert(!source.includes('open -g') && !source.includes('osascript'), 'grok port must not call open -g or osascript')
assert(!source.includes('/Users/caffrey'), 'grok port must not hardcode user home')
assert(!/\bexec(File|Sync)?\(/.test(source) && !source.includes('spawnProcess'), 'grok port must not spawn side-effect processes')

console.log('grok port check ok')

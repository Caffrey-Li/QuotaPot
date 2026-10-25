import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPrompt } from '../prompts.mjs'
import {
  activeProfile,
  capabilities,
  diskTargets,
  discoverAt,
  listJsonl,
  listSessionFiles,
  menu,
  modelsFromUsage,
  newChatCommand,
  parseLine,
  paths,
  promptProfile,
  resolveWorkspace,
  resumeCommand,
  sessionMeta,
  sessionTrend,
  shellQuote,
  tallyFiles,
  terminalArgs,
  usageOf,
  windowFor,
} from './index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(root, 'fixtures')

function assert(condition, message) {
  if (!condition) throw new Error('claude check: ' + message)
}

// discovery: both sources, desktop only, nothing
const home = path.join(fixtures, 'home')
const where = { ...paths(home, {}), apps: [path.join(home, 'Applications', 'Claude.app')] }
const both = discoverAt(where)
assert(both.code && both.desktop, 'fixture home should show Claude Code and the desktop app')
const desktopHome = path.join(fixtures, 'desktop-only')
const desktopOnly = discoverAt({ ...paths(desktopHome, {}), apps: [path.join(desktopHome, 'Applications', 'Claude.app')] })
assert(!desktopOnly.code && desktopOnly.desktop, 'desktop-only fixture detected wrongly')
const none = discoverAt({ ...paths(path.join(fixtures, 'missing'), {}), apps: [path.join(fixtures, 'missing', 'Claude.app')] })
assert(!none.code && !none.desktop, 'missing home was detected as installed')
assert(paths('/h', { CLAUDE_CONFIG_DIR: '/custom' }).projectsDir === '/custom/projects', 'CLAUDE_CONFIG_DIR ignored')

// usage: dedupe streaming lines and replayed messages, skip synthetic, keep subagents, honour the start
assert(parseLine('{not json') === null && parseLine('') === null, 'bad line was parsed')
assert(usageOf({ type: 'assistant', message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 1 } } }) === null, 'synthetic message counted')
const files = listJsonl(where.projectsDir, 0)
assert(files.length === 3, 'expected two sessions and one subagent transcript, got ' + files.length)
const since15 = Date.parse('2026-10-15T00:00:00.000Z')
const recent = tallyFiles(files, since15)
assert(recent.tokens === 509407, 'usage since 10-15 drifted: ' + recent.tokens)
assert(recent.calls === 7, 'calls since 10-15 drifted: ' + recent.calls)
const sonnet = recent.models.find((row) => row.model.startsWith('claude-sonnet'))
assert(sonnet && sonnet.output === 511 && sonnet.cacheRead === 486000 && sonnet.cacheWrite === 22700 && sonnet.input === 136, 'sonnet buckets drifted')
assert(recent.models.some((row) => row.model.startsWith('claude-haiku') && row.tokens === 60), 'subagent usage missing')
assert(!recent.models.some((row) => row.model.startsWith('claude-opus')), 'usage before the start was counted')
const month = tallyFiles(files, Date.parse('2026-10-01T00:00:00.000Z'))
assert(month.tokens === 510507 && month.calls === 8, 'usage since 10-01 drifted: ' + month.tokens + '/' + month.calls)

// models: unit-free list from usage, no fake status or speed
const listed = modelsFromUsage(recent, 7)
assert(listed.ok && listed.models.every((row) => row.speed === null && row.statusText === '无状态'), 'models invented a status or speed')
assert(modelsFromUsage({ models: [] }, 7).degraded, 'empty model list did not degrade')

// sessions: names, project, context size, window, 80% warning input
const sessions = listSessionFiles(where.projectsDir)
assert(sessions.length === 2, 'subagent transcript was listed as a chat')
const s1 = sessions.find((item) => item.id.startsWith('1111'))
const meta = sessionMeta(s1)
assert(meta.name === '示例对话', 'session title drifted: ' + meta.name)
assert(meta.workspace === 'demo' && meta.workspacePath === '/work/demo', 'session project drifted')
assert(meta.used === 167005 && meta.limit === 200000 && meta.percent === 83.5, 'context drifted: ' + JSON.stringify(meta))
assert(meta.model.startsWith('claude-sonnet'), 'sidechain model leaked into the chat model')
const s2 = sessionMeta(sessions.find((item) => item.id.startsWith('2222')))
assert(s2.name === '另一个请求', 'slash command used as a title: ' + s2.name)
assert(windowFor('claude-sonnet-4-5', 250000) === 1000000 && windowFor('claude-sonnet-4-5', 1000) === 200000, 'window inference drifted')

// compaction: explicit boundary, loss measured against the next sample, sidechain excluded
const trend = sessionTrend(s1)
assert(trend.compactions === 1 && trend.boundaries === 1, 'compaction count drifted')
assert(Math.abs(trend.lostRatio - (170210 - 20010) / 170210) < 1e-6, 'compaction loss drifted: ' + trend.lostRatio)
assert(trend.samples === 5 && trend.maxUsed === 170210, 'context samples drifted')

// prompts: CLAUDE.md, /compact, and no context line for desktop only
const chat = JSON.parse(fs.readFileSync(path.join(fixtures, 'prompts.json'), 'utf8')).chat
const handoff = renderPrompt(activeProfile(both), 'handoff', chat)
assert(handoff.startsWith('请整理当前这条 Claude Code 对话'), 'handoff product drifted')
assert(handoff.includes('上下文大约已用 84%，窗口大约 16.7万 / 20万 token。'), 'handoff context line drifted')
assert(handoff.includes('需要压缩时可以使用 /compact。'), 'compact command missing')
assert(renderPrompt(activeProfile(both), 'new', null).includes('1. CLAUDE.md：'), 'instructions file drifted')
assert(renderPrompt(activeProfile(both), 'crash', null).includes('CLAUDE.md'), 'crash prompt lost CLAUDE.md')
const desk = renderPrompt(activeProfile(desktopOnly), 'handoff', chat)
assert(desk.startsWith('请整理当前这条 Claude 对话') && !desk.includes('上下文大约已用') && !desk.includes('/compact'), 'desktop-only prompt kept Claude Code details')
assert(!renderPrompt(activeProfile(desktopOnly), 'inherit', chat).includes('上下文当时'), 'desktop inherit kept a context line')
assert(promptProfile.instructionsFile === 'CLAUDE.md', 'profile drifted')

// actions: generated Terminal commands only, nothing executed here
assert(shellQuote("it's\nok") === "$'it\\'s\\nok'", 'shell quoting drifted')
const resume = resumeCommand({ chatId: '11111111-1111-4111-8111-111111111111', cwd: '/work/my demo' })
assert(resume === "cd $'/work/my demo' && claude --resume 11111111-1111-4111-8111-111111111111", 'resume command drifted: ' + resume)
let rejected = false
try { resumeCommand({ chatId: "x; rm -rf ~", cwd: '/work' }) } catch { rejected = true }
assert(rejected, 'bad chat id reached the shell')
const fresh = newChatCommand({ text: '第一行\n第二行 "引号" $HOME `x`', cwd: '/work/demo' })
assert(fresh === "cd $'/work/demo' && claude $'第一行\\n第二行 \"引号\" $HOME `x`'", 'new chat command drifted: ' + fresh)
const args = terminalArgs(fresh)
assert(args.at(-1) === fresh && !args.slice(0, -1).some((part) => part.includes('claude')), 'command was spliced into AppleScript')
assert(resolveWorkspace('demo', sessions) === '/work/demo', 'workspace basename not resolved')
assert(resolveWorkspace('nope', sessions) === '', 'unknown workspace resolved')
assert(!capabilities.actions.paste && !capabilities.actions.open && !capabilities.actions.spawn, 'actions must stay off until the UI is port-aware')

// disk and menu
const disks = diskTargets()
for (const id of ['claude-home', 'claude']) assert(disks.find((item) => item.id === id)?.safe === false, id + ' was marked safe')
assert(disks.filter((item) => item.safe).every((item) => /Cache|Caches/.test(item.path)), 'a non-cache path was marked safe')
const quota = menu()
assert(quota.degraded && !('usedPercent' in quota), 'menu invented a quota')

// hygiene: no shelling out to sqlite3, no Cmd+V, fixtures carry no secrets or user paths
const source = fs.readFileSync(path.join(root, 'index.mjs'), 'utf8')
assert(!source.includes('sqlite3') && !source.includes('keystroke'), 'port shells out to sqlite3 or sends keystrokes')
const blob = fs.readdirSync(fixtures, { recursive: true })
  .map((name) => path.join(fixtures, name))
  .filter((file) => fs.statSync(file).isFile())
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
assert(!/sk-ant|eyJ[A-Za-z0-9_-]{10}|@[a-z0-9-]+\.[a-z]|\/Users\//i.test(blob), 'fixtures contain a secret, email or user path')

console.log('claude port check ok')

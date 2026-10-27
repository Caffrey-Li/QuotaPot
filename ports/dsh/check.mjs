import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRead, openWrite } from '../sqlite.mjs'
import * as port from './index.mjs'
import {
  balanceMenu,
  capabilities,
  discoverAt,
  normalizeBalance,
  parseCredentialRefs,
  promptProfile,
  prompts,
  usageFromDb,
} from './index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name), 'utf8'))
const read = (name) => fs.readFileSync(path.join(root, 'fixtures', name), 'utf8')
const now = new Date(2026, 9, 25, 12, 0, 0).getTime()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const found = discoverAt(path.join(root, 'fixtures', 'home'))
assert(found.ok && found.installed, 'fixture home was not discovered')
assert(!discoverAt(path.join(root, 'fixtures', 'missing')).installed, 'missing home was installed')

const file = path.join(os.tmpdir(), 'quotapot-dsh-check.db')
fs.rmSync(file, { force: true })
const writing = openWrite(file)
writing.exec(`
  CREATE TABLE calls (
    key TEXT PRIMARY KEY, session TEXT NOT NULL, time INTEGER NOT NULL,
    provider TEXT NOT NULL, model TEXT NOT NULL, kind TEXT NOT NULL, live INTEGER NOT NULL,
    input INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL,
    output INTEGER NOT NULL
  );
  CREATE TABLE owners (session TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL);
`)
const insertCall = writing.prepare(`
  INSERT INTO calls (key, session, time, provider, model, kind, live, input, cache_read, cache_write, output)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertOwner = writing.prepare('INSERT OR REPLACE INTO owners (session, owner, name) VALUES (?, ?, ?)')
for (const [index, row] of fixture('usage.json').rows.entries()) {
  insertCall.run('demo-' + index, row.session, now + row.offsetHours * 3_600_000, row.provider, row.model, row.kind, row.live, row.input, row.cache_read, row.cache_write, row.output)
  insertOwner.run(row.session, row.owner, row.name)
}
writing.close()

const today = usageFromDb(file, 1, now)
assert(today.ok && today.unit === 'token', 'usage unit drifted')
assert(today.tokens === 300 && today.calls === 2, 'today usage drifted')
assert(today.models.length === 1 && today.models[0].model === 'deepseek-flash', 'today model drifted')
assert(today.sessions.length === 1 && today.sessions[0].name === '示例 Bot', 'today session drifted')
assert(today.owners[0].name === '示例 Bot' && today.owners[0].kind === 'bot', 'owner grouping drifted')

const week = usageFromDb(file, 7, now)
assert(week.days === 7 && week.tokens === 315 && week.calls === 3, '7-day usage drifted')
assert(week.models.some((item) => item.model === 'deepseek-v4-flash'), '7-day model missing')
assert(week.sessions.length === 2, '7-day sessions drifted')

const month = usageFromDb(file, 30, now)
assert(month.days === 30 && month.tokens === 315, '30-day range drifted')

assert(capabilities.usage && capabilities.quota && !capabilities.chats && !capabilities.modelStatus, 'DS Bot sections drifted')
for (const gone of ['models', 'chats', 'headers', 'paste', 'open', 'spawn', 'diskTargets', 'peekContext']) assert(!(gone in port), gone + ' should not be exported')
assert(promptProfile.instructionsFile === 'AGENTS.md' && promptProfile.hasContext === false, 'prompt profile drifted')
assert(promptProfile.compactCommand === '' && promptProfile.warnPercent === 80, 'prompt compact/threshold drifted')

const fresh = prompts('new', null).text
assert(fresh.startsWith('这是一次新的 DS Bot 对话。') && fresh.includes('1. AGENTS.md：'), 'new prompt drifted')
const handoff = prompts('handoff', null).text
assert(!handoff.includes('上下文大约已用'), 'handoff invented context')
assert(!handoff.includes('压缩过 0 次'), 'handoff invented a compaction count')
assert(!handoff.includes('需要压缩时可以使用'), 'handoff invented a compact command')
assert(handoff.includes('如果中间做过摘要'), 'handoff lost the summary caveat')
assert(prompts('crash', null).text.includes('AGENTS.md'), 'crash prompt drifted')
assert(prompts('unknown', null).degraded, 'unknown prompt kind was accepted')

const balance = normalizeBalance(fixture('balance.json'), now)
assert(balance.ok && balance.balances[0].total === 12.34, 'balance fixture drifted')
const menu = balanceMenu(balance)
assert(menu.ok && menu.unit === 'currency' && menu.amount === 12.34, 'menu unit drifted')
assert(menu.display === '余额 ¥12.34', 'menu display drifted')
assert(!('tokens' in menu), 'balance was put in the token slot')
assert(normalizeBalance({ is_available: true, balance_infos: [] }).degraded, 'empty balance was accepted')

const refs = read('credentials.yaml')
assert(parseCredentialRefs(refs, 'DEEPSEEK_API_KEY') === 'sk-demo-only-not-real', 'credential ref parse drifted')
assert(!JSON.stringify({ menu }).includes('sk-demo-only-not-real'), 'menu leaked the key')

assert(capabilities.actions.open === false && capabilities.actions.paste === false && capabilities.actions.spawn === false, 'actions capability drifted')

const reading = openRead(file)
let rejected = false
try {
  reading.prepare('DELETE FROM calls').run()
} catch {
  rejected = true
}
reading.close()
assert(rejected, 'read-only database accepted a write')
fs.rmSync(file, { force: true })

const source = fs.readFileSync(path.join(root, 'index.mjs'), 'utf8')
assert(!source.includes('/usr/bin/sqlite3') && !source.includes('execSync'), 'DSH port shells out to sqlite')
assert(!source.includes('/Users/caffrey'), 'DSH port contains an absolute user path')
assert(!JSON.stringify(today).includes('sk-demo-only-not-real'), 'usage leaked the fixture key')

console.log('dsh port check ok')

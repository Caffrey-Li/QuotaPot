import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPrompt } from '../prompts.mjs'
import { openRead, openWrite } from '../sqlite.mjs'
import * as port from './index.mjs'
import {
  aggregateCredits,
  capabilities,
  chatsFromRows,
  creditsByModel,
  dayStart,
  discoverFrom,
  hasCredits,
  open,
  parseCredits,
  promptProfile,
  prompts,
  readSessionRows,
  readUsageRows,
  usageFromRows,
  workbuddyChatUrl,
} from './index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const usageFixture = fixture('session-usage.json')
const sessionFixture = fixture('sessions.json')
const now = Number(usageFixture.now)

// 1. the real SQL runs against a fixture database, no WorkBuddy required
const file = path.join(os.tmpdir(), 'quotapot-workbuddy-check.db')
fs.rmSync(file, { force: true })
const writing = openWrite(file)
writing.exec(`
  CREATE TABLE session_usage (
    session_id TEXT PRIMARY KEY,
    used INTEGER NOT NULL,
    size INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    credit_json TEXT
  )`)
writing.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT,
    custom_title TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    model TEXT
  )`)
const insertUsage = writing.prepare('INSERT INTO session_usage (session_id, used, size, updated_at, credit_json) VALUES (?, ?, ?, ?, ?)')
for (const row of usageFixture.rows) insertUsage.run(row.sessionId, row.used, row.size, row.updatedAt, row.creditJson)
const insertSession = writing.prepare('INSERT INTO sessions (id, cwd, user_id, title, custom_title, created_at, updated_at, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
for (const row of sessionFixture.rows) {
  insertSession.run(row.id, row.cwd, 'demo-user', row.title, row.customTitle, row.createdAt, row.updatedAt, row.model)
}
writing.close()

const rows = readUsageRows(file)
const sessions = readSessionRows(file)
assert(rows.length === 4 && sessions.length === 4, 'fixture rows did not round-trip')
assert(rows[0].sessionId === '11111111-1111-4111-8111-111111111111' && rows[0].used === 246000 && rows[0].size === 300000, 'usage row drifted')
assert(sessions[1].model === 'hy3' && sessions[1].cwd === '/work/demo', 'session row drifted')
assert(readUsageRows(path.join(os.tmpdir(), 'quotapot-missing.db')) .length === 0, 'a missing database should read as empty')
assert(discoverFrom(file).installed === true && discoverFrom(file).home === '~/.workbuddy', 'discover drifted')
const missing = discoverFrom(path.join(os.tmpdir(), 'quotapot-missing.db'))
assert(missing.installed === false && missing.degraded === true && missing.reason.includes('WorkBuddy'), 'missing install did not degrade')

// 2. credits: the unit is credits, never tokens
assert(parseCredits('').credits === 0 && parseCredits('').calls === 0, 'empty credit_json must not count')
assert(parseCredits('not json').calls === 0, 'broken credit_json must not count')
const parsed = parseCredits('{"aaaa":1.5,"bbbb":2}')
assert(parsed.credits === 3.5 && parsed.calls === 2, 'credits parsing drifted')
assert(hasCredits(rows) === true, 'fixture lost its credits')
assert(hasCredits([{ creditJson: '' }]) === false, 'empty rows must not claim credits')

assert(aggregateCredits(rows, 0).credits === 50.5 && aggregateCredits(rows, 0).calls === 4, 'all-time credits drifted')
const recent = aggregateCredits(rows, 1792931400000)
assert(recent.credits === 20.5 && recent.calls === 3 && recent.sessions === 2, 'windowed credits drifted')
const empty = aggregateCredits(rows, 1793000000000)
assert(empty.credits === 0 && empty.calls === 0 && empty.sessions === 0, 'future window should be empty')

const byModel = creditsByModel(rows, sessions, 0)
assert(byModel.length === 3 && byModel[0].model === 'glm-5.2' && byModel[0].credits === 30, 'credits by model drifted')
assert(byModel[1].model === 'hy4-preview' && byModel[1].credits === 12.5, 'model order drifted')
assert(byModel[2].model === 'hy3' && byModel[2].calls === 2, 'hy3 credits drifted')
assert(creditsByModel(rows, [], 0)[0].model === '未知模型', 'credits without a session row invented a model')

const usage = usageFromRows(rows, sessions, 30, now)
assert(usage.ok && usage.unit === 'credits', 'usage unit is not credits')
assert(usage.days === 30 && usage.tokens === 50.5 && usage.credits === 50.5 && usage.calls === 4, 'usage totals drifted')
assert(usage.models[0].model === 'glm-5.2' && usage.models[0].tokens === 30, 'usage model rows drifted')
assert(usage.truncated === false && usage.note.includes('毫秒'), 'usage note drifted')
const oneDay = usageFromRows(rows, sessions, 1, now)
assert(oneDay.days === 1 && oneDay.unit === 'credits', 'one day usage drifted')
const start = dayStart(1, now)
assert(start <= now && start > now - 2 * 86_400_000, 'day start drifted')

// 4. chats: real context percent, compression never measured
const chats = chatsFromRows(rows, sessions)
assert(chats.length === 4, 'chat list drifted')
assert(chats[0].percent === 99 && chats[0].warn === true, 'warn threshold drifted')
assert(chats[0].name === '示例对话四' && chats[0].model === 'glm-5.2' && chats[0].workspace === 'other', 'chat row drifted')
assert(chats[0].used === 190000 && chats[0].limit === 192000 && chats[0].credits === 30, 'chat numbers drifted')
assert(chats[1].percent === 88.5 && chats[3].percent === 20.8 && chats[3].warn === false, 'chat order drifted')
assert(chats.every((item) => item.measured === false), 'compression was measured without samples')
assert(chats.every((item) => item.compactions == null && item.lostRatio == null && item.growth == null), 'unmeasured chat invented a trend')
assert(chatsFromRows([{ sessionId: 'x', used: 0, size: 0, updatedAt: 0, creditJson: '' }], []).length === 0, 'empty context rows must be dropped')

// 5. prompts: WorkBuddy file names, no fake context numbers
const chat = fixture('prompts.json').chat
const handoff = prompts('handoff', chat).text
const fresh = prompts('new', null).text
const crash = prompts('crash', null).text
const inherit = prompts('inherit', chat).text
const bare = prompts('handoff', null).text
assert(promptProfile.instructionsFile === 'CODEBUDDY.md', 'instructions file is not WorkBuddy convention')
assert(promptProfile.hasContext === true && promptProfile.warnPercent === 80, 'prompt profile drifted')
assert(handoff.includes('上下文大约已用 82%，窗口大约 24.6万 / 30万 token。'), 'handoff context line drifted')
assert(handoff.includes('需要压缩时可以使用 /compact。'), 'compact command was dropped')
assert(!handoff.includes('压缩过'), 'compression count was invented')
assert(fresh.startsWith('这是一次新的 WorkBuddy 对话。') && fresh.includes('1. CODEBUDDY.md：'), 'new-chat prompt drifted')
assert(crash.includes('CODEBUDDY.md') && crash.includes('崩溃'), 'crash prompt drifted')
assert(inherit.includes('上下文当时大约 82%，24.6万 / 30万 token。'), 'inherit context line drifted')
assert(inherit.endsWith('工作区保持在项目 quotapot。'), 'inherit workspace drifted')
assert(bare.includes('上下文大约已用 80%。') && bare.includes('如果中间做过摘要'), 'empty handoff drifted')
const quiet = renderPrompt({ ...promptProfile, hasContext: false }, 'handoff', chat)
assert(!quiet.includes('上下文大约已用'), 'missing context still rendered a percent')
assert(prompts('other', chat).degraded === true, 'unknown prompt kind did not degrade')

// 6. capabilities and actions
assert(capabilities.usage && capabilities.chats && !capabilities.quota && !capabilities.modelStatus, 'WorkBuddy sections drifted')
assert(capabilities.actions.open === (process.platform === 'darwin') && capabilities.actions.paste === 'copy' && capabilities.actions.spawn === false, 'actions drifted')
for (const gone of ['models', 'menu', 'spawn', 'diskTargets']) assert(!(gone in port), gone + ' should not be exported')
assert(workbuddyChatUrl('11111111-1111-4111-8111-111111111111') === 'workbuddy://chat/11111111-1111-4111-8111-111111111111', 'chat url drifted')
const rejected = await open({ chatId: 'nope' })
assert(rejected.ok === false && rejected.error === '对话编号无效', 'bad chat id was accepted')
assert((await open({ phase: 'done' })).ok === true, 'open done phase drifted')

// 8. safety: read-only opens, no shelling out, no secrets
const source = fs.readFileSync(path.join(root, 'index.mjs'), 'utf8')
assert(!source.includes('/usr/bin/sqlite3') && !source.includes('python3'), 'port still shells out to sqlite')
assert(source.includes('openRead') && !source.includes('openWrite'), 'port opened a database for writing')
for (const secret of ['apiKey', 'sk-', 'Authorization', 'Bearer ']) {
  assert(!source.includes(secret), `port source mentions ${secret}`)
}
for (const name of fs.readdirSync(path.join(root, 'fixtures'))) {
  const text = fs.readFileSync(path.join(root, 'fixtures', name), 'utf8')
  assert(!text.includes('sk-') && !text.includes('@') && !text.includes('/Users/'), `fixture ${name} leaked real data`)
}

let rejectedWrite = false
try {
  const locked = openRead(file)
  locked.prepare('DELETE FROM session_usage').run()
  locked.close()
} catch {
  rejectedWrite = true
}
assert(rejectedWrite, 'read-only database accepted a write')
fs.rmSync(file, { force: true })

console.log('workbuddy port check ok')

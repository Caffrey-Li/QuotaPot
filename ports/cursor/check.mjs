import { createCipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPrompt } from '../prompts.mjs'
import { openRead, openWrite } from '../sqlite.mjs'
import {
  aggregateUsage,
  capabilities,
  diskTargets,
  modelStatus,
  modelsFromCatalog,
  parseComposerLine,
  promptProfile,
  prompts,
  composerRichText,
  unsealCursorSecret,
} from './index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const usage = fixture('usage-events.json')
const totals = aggregateUsage(usage.events, usage.start)
assert(totals.tokens === 16 && totals.calls === 1 && totals.models.length === 1, 'usage fixture drifted')
assert(totals.models[0].model === 'demo-a', 'usage fixture kept the early event')

const catalog = modelsFromCatalog(fixture('model-catalog.json'))
assert(catalog.ok && catalog.models[0].statusText === '降级', 'degraded model not sorted first')
assert(catalog.models.every((item) => item.speed == null), 'catalog invented a speed')
assert(catalog.models.some((item) => item.detail.includes('密钥无效')), 'error hint drifted')
assert(!JSON.stringify(catalog).includes('apiKey'), 'catalog leaked a key field')

const line = fs.readFileSync(path.join(root, 'fixtures', 'composer-line.txt'), 'utf8').trim()
const row = parseComposerLine(line)
assert(row && row.name === '示例对话' && row.workspace === 'demo' && row.conversation === 12, 'composer fixture drifted')
assert(parseComposerLine('not-an-id~|~x~|~m~|~0~|~0~|~0~|~0~|~0~|~~|~0~|~[]') === null, 'bad composer id was accepted')

const chat = fixture('prompts.json').chat
const expected = {
  handoff: prompts('handoff', chat).text,
  empty: prompts('handoff', null).text,
  inherit: prompts('inherit', chat).text,
  crash: prompts('crash', null).text,
  fresh: prompts('new', null).text,
}
assert(expected.handoff.includes('上下文大约已用 82%，窗口大约 21.1万 / 25.6万 token。'), 'handoff context line drifted')
assert(expected.handoff.includes('压缩过 2 次，平均大约丢掉 25% 的窗口。'), 'handoff compaction line drifted')
assert(expected.empty.includes('上下文大约已用 80%。'), 'empty handoff lost the default percent')
assert(expected.empty.includes('如果中间做过摘要'), 'empty handoff invented a compaction count')
assert(expected.inherit.includes('上下文当时大约 82%，21.1万 / 25.6万 token。'), 'inherit context line drifted')
assert(expected.inherit.endsWith('工作区保持在项目 demo。'), 'inherit workspace drifted')
assert(expected.crash.includes('AGENTS.md') && expected.crash.includes('崩溃'), 'crash prompt drifted')
assert(expected.fresh.startsWith('这是一次新的 Cursor 对话。') && expected.fresh.includes('1. AGENTS.md：'), 'new-chat prompt drifted')
const quiet = renderPrompt({ ...promptProfile, hasContext: false, compactCommand: '/compact' }, 'handoff', chat)
assert(!quiet.includes('上下文大约已用'), 'missing context still rendered a percent')
assert(quiet.includes('需要压缩时可以使用 /compact。'), 'compact command was dropped')

assert(modelStatus(1).statusText === '降级' && modelStatus(2).statusText === '停用' && modelStatus(0).detail === '', 'model status drifted')
assert(capabilities.actions.paste && capabilities.actions.spawn, 'cursor capabilities drifted')
assert(capabilities.actions.open === (process.platform === 'darwin'), 'cursor open should follow the platform')
const disks = diskTargets()
assert(disks.find((item) => item.id === 'cursor')?.safe === false, 'cursor data was marked safe')
assert(disks.find((item) => item.id === 'cursor-cache')?.safe === true, 'cursor cache was marked read-only')
const sealKey = randomBytes(32)
const nonce = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', sealKey, nonce)
const sealed = Buffer.concat([cipher.update('secret-token'), cipher.final(), cipher.getAuthTag()])
const packed = `cursor-safe-storage:v1:${Buffer.concat([Buffer.from('v10'), nonce, sealed]).toString('base64')}`
assert(unsealCursorSecret(packed, sealKey) === 'secret-token', 'windows token unwrap drifted')

const source = fs.readFileSync(path.join(root, 'index.mjs'), 'utf8')
assert(!source.includes('/usr/bin/sqlite3') && !source.includes('python3'), 'cursor port still shells out to sqlite')

const file = path.join(os.tmpdir(), 'quotapot-cursor-check.db')
fs.rmSync(file, { force: true })
const writing = openWrite(file)
writing.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)')
writing.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run('composerData:x', '{"text":""}')
const updated = writing.prepare(`UPDATE cursorDiskKV SET value = json_set(CAST(value AS TEXT), '$.text', ?, '$.richText', ?) WHERE key = ?`)
  .run('你好', '你好', 'composerData:x')
assert(updated.changes === 1, 'draft write did not change a row')
writing.close()
const reading = openRead(file)
const saved = reading.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get('composerData:x')
reading.close()
assert(JSON.parse(saved.value).text === '你好', 'draft write did not round-trip')
const rich = JSON.parse(composerRichText('你好\n\n下一行'))
assert(rich.root.type === 'root' && rich.root.children.length === 3, 'composer draft is not a document')
assert(rich.root.children[0].children[0].text === '你好', 'composer draft dropped the prompt')
assert(rich.root.children[1].children.length === 0, 'blank line invented text')
assert(rich.root.children[2].children[0].text === '下一行', 'composer draft dropped the second line')
assert(composerRichText('你好') !== '你好', 'composer draft must not store plain text as the document')
let rejected = false
try {
  const locked = openRead(file)
  locked.prepare('DELETE FROM cursorDiskKV').run()
  locked.close()
} catch {
  rejected = true
}
assert(rejected, 'read-only database accepted a write')
fs.rmSync(file, { force: true })

console.log('cursor port check ok')

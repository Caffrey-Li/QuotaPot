import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as port from './index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const fixtureText = (name) => fs.readFileSync(path.join(root, 'fixtures', `rollout-${name}.jsonl`), 'utf8')
const fixture = (name) => port.parseRollout(fixtureText(name))
const localEnd = (year, month, day) => new Date(year, month - 1, day, 23, 59, 59).getTime()
const total = (row) => row.events.reduce((sum, event) => sum + event.total_tokens, 0)
const cumulative = fixture('cumulative')
const modern = fixture('modern')
const unmetered = fixture('unmetered')
const duplicate = fixture('duplicate')
const reset = fixture('reset')
const compacted = fixture('compacted')

for (const key of ['discover', 'usage', 'chats', 'headers', 'prompts', 'paste', 'spawn', 'open', 'menu', 'peekUsage', 'peekContext']) assert.equal(typeof port[key], 'function', key)
for (const key of ['models', 'diskTargets']) assert.equal(port[key], undefined, key + ' should not be exported')
assert.equal(port.id, 'codex')
assert.equal(port.name, 'Codex')
assert.deepEqual(port.capabilities, { usage: true, chats: true, quota: true, modelStatus: false, actions: { open: false, paste: 'copy', spawn: false } })
assert.equal(port.peekUsage(1), null)
assert.equal(port.peekContext(), null)

// Real cumulative counters must not be summed, nor their cached/reasoning subsets added twice.
assert.equal(cumulative.samples, 3)
assert.equal(total(cumulative), 107544)
const today = port.usageFromRollouts([cumulative, unmetered], 1, localEnd(2026, 8, 27))
assert.equal(today.unit, 'token')
assert.equal(today.tokens, 107544)
assert.equal(today.calls, 3)
assert.equal(today.sessions, 1)
assert.equal(today.excludedSessions, 1)
assert.equal(today.models[0].input, 24547)
assert.equal(today.models[0].cacheRead, 81408)
assert.equal(today.models[0].output, 1589)
assert.equal(today.models[0].reasoning, 442)
assert.equal(today.models[0].input + today.models[0].cacheRead + today.models[0].output, today.tokens)
assert(today.truncated && today.truncatedNote.includes('未计入'))
assert.equal(unmetered.samples, 0)
const unknown = port.usageFromRollouts([unmetered], 1)
assert(unknown.degraded && !('tokens' in unknown))
assert(port.usageFromRollouts([], 1).degraded)
assert(port.usageFromRollouts([cumulative], 2).degraded)

// The first counter of an excerpt may include inherited history; use only its recorded last usage.
const duplicateEvents = fixtureText('duplicate').trim().split('\n').map(JSON.parse).filter((event) => event.type === 'event_msg')
assert.equal(duplicate.events.length, 1)
assert.equal(total(duplicate), duplicateEvents[0].payload.info.last_token_usage.total_tokens)
assert(duplicate.incomplete)
const resetEvents = fixtureText('reset').trim().split('\n').map(JSON.parse).filter((event) => event.type === 'event_msg')
assert.equal(total(reset), resetEvents.reduce((sum, event) => sum + event.payload.info.last_token_usage.total_tokens, 0))
assert.equal(reset.events.length, 2)

// Filter individual deltas by local day, keeping the baseline from before the selected range.
const now = localEnd(2026, 10, 25)
const relative = { ...cumulative, events: cumulative.events.map((event, index) => ({ ...event, at: port.rangeStart([1, 7, 30][index], now) + 3600000 })) }
assert.equal(port.usageFromRollouts([relative], 1, now).tokens, 31132)
assert.equal(port.usageFromRollouts([relative], 7, now).tokens, 68230)
assert.equal(port.usageFromRollouts([relative], 30, now).tokens, 107544)
assert.equal(port.usageFromRollouts([relative], 1, port.rangeStart(1, now)).tokens, 0)
const zeroReset = fixtureText('cumulative').trim().split('\n').map(JSON.parse)
const lastEvent = structuredClone(zeroReset.at(-1))
for (const key of Object.keys(lastEvent.payload.info.total_token_usage)) lastEvent.payload.info.total_token_usage[key] = 0
lastEvent.payload.info.last_token_usage = { ...lastEvent.payload.info.total_token_usage }
const afterReset = structuredClone(zeroReset.at(-1))
afterReset.payload.info.total_token_usage = { ...afterReset.payload.info.last_token_usage }
const restarted = port.parseRollout([...zeroReset, lastEvent, afterReset].map(JSON.stringify).join('\n'))
assert.equal(total(restarted), 146858)

// Attribution follows turn_context at the time of the increment, not the final session model.
const changed = fixtureText('cumulative').trim().split('\n').map(JSON.parse)
changed.splice(changed.length - 1, 0, { type: 'turn_context', timestamp: changed.at(-1).timestamp, payload: { model: 'fixture-second-model' } })
const changedModels = port.usageFromRollouts([port.parseRollout(changed.map(JSON.stringify).join('\n'))], 1, localEnd(2026, 8, 27)).models
assert.equal(changedModels.find((item) => item.model === 'fixture-second-model').tokens, 39314)

const chats = port.chatsFromRollouts([cumulative, unmetered, compacted])
assert.equal(chats.warnPercent, 80)
assert.equal(chats.chats.length, 3)
const measured = chats.chats.find((item) => item.id === cumulative.id)
const empty = chats.chats.find((item) => item.id === unmetered.id)
const compactChat = chats.chats.find((item) => item.id === compacted.id)
assert.equal(measured.used, 39314)
assert.equal(measured.limit, 258400)
assert.equal(measured.percent, 39314 / 258400 * 100)
assert.equal(measured.warn, false)
assert.equal(empty.percent, null)
assert.equal(empty.used, null)
assert.equal(empty.compactions, null)
assert.equal(empty.measured, false)
assert.equal(compactChat.compactions, 2)
assert(compactChat.warn)
assert(chats.chats.every((item) => !item.measured && item.lostRatio === null && item.growth === null))
const noWindow = structuredClone(cumulative)
noWindow.context.limit = null
assert.equal(port.chatsFromRollouts([noWindow]).chats[0].percent, null)
const boundary = structuredClone(cumulative)
boundary.context = { used: 80, limit: 100, at: now }
assert(port.chatsFromRollouts([boundary]).chats[0].warn)

for (const kind of ['new', 'handoff', 'inherit', 'crash']) {
  const prompt = port.prompts(kind, measured)
  assert(prompt.ok && prompt.kind === kind && prompt.text.length > 50)
}
assert(port.prompts('new').text.includes('AGENTS.md'))
assert(port.prompts('handoff', measured).text.includes('/compact'))
assert(port.prompts('handoff', measured).text.includes('上下文大约已用'))
for (const chat of [null, empty, { used: null, limit: 100, percent: null }]) {
  for (const kind of ['handoff', 'inherit']) assert(!port.prompts(kind, chat).text.includes('上下文大约') && !port.prompts(kind, chat).text.includes('上下文当时'))
}
assert(!port.prompts('handoff', compactChat).text.includes('平均大约丢掉'))
assert(port.prompts('inherit', measured).text.includes('然后停下来'))
assert(port.prompts('invalid').degraded)

const limit = port.menuFromRollouts([modern], modern.limits.at)
assert.equal(limit.unit, 'percent')
assert.equal(limit.primary.windowMinutes, 300)
assert.equal(limit.secondary.windowMinutes, 10080)
assert(limit.label.includes('窗口') && limit.note.includes('非 token'))
assert(!('tokens' in limit))
const stale = port.menuFromRollouts([modern], modern.limits.at + 16 * 60000)
assert(stale.stale && stale.note.includes('记录已过时') && stale.note.includes(new Date(stale.updatedAt).toISOString()))
assert.equal(port.menuFromRollouts([cumulative, modern], modern.limits.at).updatedAt, modern.limits.at)
const reserve = port.parseRollout(fixtureText('cumulative'))
assert.equal(reserve.limits, null)
assert(port.menuFromRollouts([unmetered, reserve]).degraded)
const invalidPercent = structuredClone(modern)
invalidPercent.limits.primary.used_percent = null
invalidPercent.limits.secondary = null
assert(port.menuFromRollouts([invalidPercent]).degraded)
const zeroPercent = structuredClone(modern)
zeroPercent.limits.primary.used_percent = 0
zeroPercent.limits.primary.resets_at = Math.floor(now / 1000) + 3600
assert.equal(port.menuFromRollouts([zeroPercent], now).usedPercent, 0)
const swapped = structuredClone(modern)
;[swapped.limits.primary, swapped.limits.secondary] = [swapped.limits.secondary, swapped.limits.primary]
assert.equal(port.menuFromRollouts([swapped]).primary.windowMinutes, 300)

const options = { chatId: cumulative.id, workspace: "/Users/example/project's demo", text: "-prompt 'quoted' $(touch /tmp/never-run) `never`\n第二行" }
const opening = port.terminalCommand('open', options)
assert(opening.ok && opening.command.startsWith('cd -- ') && opening.command.includes(`codex resume '${options.chatId}'`))
assert(opening.command.includes("project'\\''s demo"))
const spawning = port.terminalCommand('spawn', options)
assert(spawning.ok && spawning.command.startsWith('codex -C ') && spawning.command.includes(" -- '-prompt "))
assert(spawning.command.includes("'\\''quoted'\\''"))
assert.equal(spawning.terminal.app, 'Terminal')
assert.equal(spawning.terminal.executable, '/usr/bin/osascript')
assert(spawning.terminal.args[1].includes('tell application "Terminal"'))
assert(spawning.terminal.args[1].includes('\\n第二行'))
assert(port.terminalCommand('open', { ...options, chatId: 'bad-id' }).error)
assert(port.terminalCommand('spawn', { ...options, workspace: 'demo' }).error)
assert(port.terminalCommand('spawn', { ...options, text: '\0' }).error)
const generated = port.spawn(options)
assert(!generated.ok && generated.command === spawning.command && !generated.spawned)
assert(!(await port.open({ chatId: 'invalid' })).ok)
assert(!(await port.open({ phase: 'done' })).ok)
assert(!(await port.paste({ text: '' })).copied)

// Import and missing-product behavior in a fresh HOME; no real product data or UI actions used.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quotapot-codex-check-'))
try {
  const script = `
    const fs = await import('node:fs');
    const openSync = fs.default.openSync;
    fs.default.openSync = (file, ...args) => {
      if (String(file).endsWith('.mjs')) return openSync(file, ...args);
      throw Error('import opened product data');
    };
    // The ESM loader itself may read module files with readFileSync on some Node versions; only product data is forbidden.
    for (const key of ['readFileSync', 'readdirSync', 'createReadStream', 'existsSync', 'statSync']) {
      const original = fs.default[key];
      fs.default[key] = (file, ...args) => {
        if (key === 'readFileSync' && /\.(mjs|js|json)$/.test(String(file?.pathname ?? file))) return original(file, ...args);
        throw Error('import performed IO');
      };
    }
    const port = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    fs.default.existsSync = () => false;
    if (port.headers()?.then) throw Error('synchronous route returned a Promise');
    for (const read of [() => port.discover(), () => port.usage(1), () => port.chats(), () => port.headers(), () => port.menu()]) {
      const result = await read();
      if (!result.degraded || result.ok || !result.reason) throw Error('missing installation did not degrade');
    }
  `
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home }, stdio: 'pipe' })
  const sessions = path.join(home, '.codex', 'sessions')
  fs.mkdirSync(sessions, { recursive: true })
  for (const name of ['cumulative', 'modern', 'unmetered']) fs.writeFileSync(path.join(sessions, `${name}.jsonl`), fixtureText(name))
  const fixtureApiScript = `
    import assert from 'node:assert/strict';
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const port = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    assert(port.discover().installed);
    const headers = port.headers();
    assert(!headers.then);
    assert.equal(headers.chats.length, 3);
    const progress = [];
    const usage = await port.usage(30, event => progress.push(event));
    assert(usage.ok && usage.unit === 'token' && usage.excludedSessions === 1);
    assert(progress.length > 0 && progress.at(-1).done === progress.at(-1).total);
    assert.equal(port.peekUsage(30), usage);
    const chats = await port.chats();
    assert.equal(chats.chats.length, 3);
    assert.equal(port.peekContext(), chats);
    assert.equal((await port.menu()).unit, 'percent');
    const open = await port.open({ chatId: headers.chats[0].id });
    assert(!open.ok && open.command && open.terminal.app === 'Terminal');
    assert(!(await port.open({ chatId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).ok);
    assert((await port.usage(2)).degraded);
  `
  execFileSync(process.execPath, ['--input-type=module', '-e', fixtureApiScript], { env: { ...process.env, HOME: home }, stdio: 'pipe' })
} finally { fs.rmSync(home, { recursive: true, force: true }) }

for (const file of fs.readdirSync(path.join(root, 'fixtures'))) {
  const text = fs.readFileSync(path.join(root, 'fixtures', file), 'utf8')
  assert(!/caffrey|Bearer\s+|sk-[A-Za-z0-9]{8}|eyJ[A-Za-z0-9_-]{10}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(text), 'fixture contains private identifiers or credentials')
}
assert.equal(port.parseRollout('{"type":"event_msg","payload":{"type":"token_count"').incomplete, true)
console.log('codex port check ok (fixtures only; no Terminal or clipboard actions executed)')

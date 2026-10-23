import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateUsage,
  diskTargets,
  newerVersion,
  normalizeBalance,
  normalizeConfig,
  parseCredentialRefs,
  startOfLocalDay,
  sumTokens,
  tokenMatches,
  withDailyLimit,
} from '../index.js'

test('normalizeConfig fills safe defaults', () => {
  const config = normalizeConfig()
  assert.equal(config.apiKeyEnv, 'DEEPSEEK_API_KEY')
  assert.equal(config.baseUrl, 'https://api.deepseek.com')
  assert.equal(config.refreshSeconds, 30)
  assert.equal(config.lowBalanceThreshold, 5)
  assert.equal(config.dailyTokenLimit, 0)
  assert.equal(config.diskThresholdGB, 3)
  assert.equal(config.position, 'bottom-right')
  assert.equal(config.locale, 'auto')
})

test('normalizeConfig clamps refresh and threshold', () => {
  assert.equal(normalizeConfig({ refreshSeconds: 1 }).refreshSeconds, 10)
  assert.equal(normalizeConfig({ refreshSeconds: 9999 }).refreshSeconds, 600)
  assert.equal(normalizeConfig({ lowBalanceThreshold: -3 }).lowBalanceThreshold, 0)
  assert.equal(normalizeConfig({ lowBalanceThreshold: '2.5' }).lowBalanceThreshold, 2.5)
  assert.equal(normalizeConfig({ lowBalanceThreshold: 'nope' }).lowBalanceThreshold, 5)
  assert.equal(normalizeConfig({ dailyTokenLimit: '1000' }).dailyTokenLimit, 1000)
  assert.equal(normalizeConfig({ dailyTokenLimit: -5 }).dailyTokenLimit, 0)
  assert.equal(normalizeConfig({ dailyTokenLimit: 'nope' }).dailyTokenLimit, 0)
})

test('sumTokens counts input, cache and output', () => {
  assert.equal(sumTokens({ input: 10, cacheRead: 20, cacheWrite: 3, output: 5 }), 38)
  assert.equal(sumTokens({}), 0)
  assert.equal(sumTokens(null), 0)
})

test('startOfLocalDay returns local midnight', () => {
  const now = new Date(2026, 9, 23, 15, 42, 7).getTime()
  const start = new Date(startOfLocalDay(now))
  assert.equal(start.getHours(), 0)
  assert.equal(start.getMinutes(), 0)
  assert.equal(start.getDate(), 23)
})

test('normalizeConfig normalizes baseUrl and enums', () => {
  assert.equal(normalizeConfig({ baseUrl: 'https://proxy.example/v1/' }).baseUrl, 'https://proxy.example/v1')
  assert.equal(normalizeConfig({ baseUrl: 'ftp://example.com' }).baseUrl, 'https://api.deepseek.com')
  assert.equal(normalizeConfig({ baseUrl: 'not a url' }).baseUrl, 'https://api.deepseek.com')
  assert.equal(normalizeConfig({ position: 'middle' }).position, 'bottom-right')
  assert.equal(normalizeConfig({ position: 'top-left' }).position, 'top-left')
  assert.equal(normalizeConfig({ locale: 'fr' }).locale, 'auto')
  assert.equal(normalizeConfig({ locale: 'en' }).locale, 'en')
})

test('normalizeConfig validates the API key env name', () => {
  assert.equal(normalizeConfig({ apiKeyEnv: 'MY_DEEPSEEK_KEY' }).apiKeyEnv, 'MY_DEEPSEEK_KEY')
  assert.equal(normalizeConfig({ apiKeyEnv: 'bad-name' }).apiKeyEnv, 'DEEPSEEK_API_KEY')
  assert.equal(normalizeConfig({ apiKeyEnv: '' }).apiKeyEnv, 'DEEPSEEK_API_KEY')
})

test('normalizeBalance maps the official payload', () => {
  const data = normalizeBalance({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '34.65', topped_up_balance: '30.45', granted_balance: '4.20' },
      { currency: 'USD', total_balance: '1.00', topped_up_balance: '1.00', granted_balance: '0.00' },
    ],
  })
  assert.equal(data.ok, true)
  assert.equal(data.isAvailable, true)
  assert.equal(data.balances.length, 2)
  assert.deepEqual(data.balances[0], {
    currency: 'CNY',
    total: '34.65',
    toppedUp: '30.45',
    granted: '4.20',
  })
  assert.equal(typeof data.updatedAt, 'number')
})

test('normalizeBalance handles empty and unavailable payloads', () => {
  const empty = normalizeBalance({})
  assert.equal(empty.ok, true)
  assert.equal(empty.isAvailable, true)
  assert.deepEqual(empty.balances, [])

  const unavailable = normalizeBalance({ is_available: false, balance_infos: [] })
  assert.equal(unavailable.isAvailable, false)
})

test('normalizeBalance accepts the snake_case alias', () => {
  const data = normalizeBalance({
    balance_infos: [{ currency: 'CNY', total_balance: '1', top_up_balance: '2', granted_balance: '0' }],
  })
  assert.equal(data.balances[0].toppedUp, '2')
})

test('parseCredentialRefs reads plain and quoted values', () => {
  const text = [
    'version: 1',
    'refs:',
    '  DEEPSEEK_API_KEY: sk-plain',
    '  OTHER_KEY: "sk-quoted"',
    'records:',
    '  x: y',
  ].join('\n')
  assert.equal(parseCredentialRefs(text, 'DEEPSEEK_API_KEY'), 'sk-plain')
  assert.equal(parseCredentialRefs(text, 'OTHER_KEY'), 'sk-quoted')
  assert.equal(parseCredentialRefs(text, 'MISSING'), null)
})

test('parseCredentialRefs ignores keys outside refs', () => {
  const text = ['version: 1', 'records:', '  DEEPSEEK_API_KEY: sk-record'].join('\n')
  assert.equal(parseCredentialRefs(text, 'DEEPSEEK_API_KEY'), null)
})

test('tokenMatches is constant-time and length-safe', () => {
  assert.equal(tokenMatches('abc', 'abc'), true)
  assert.equal(tokenMatches('abc', 'abd'), false)
  assert.equal(tokenMatches('abc', 'ab'), false)
  assert.equal(tokenMatches('', ''), false)
  assert.equal(tokenMatches('abc', undefined), false)
})


test('aggregateUsage groups owners and computes session spans', () => {
  const rows = [
    { time: 1000, owner: 'bot:a', name: 'Alpha', input: 10, cacheRead: 0, cacheWrite: 0, output: 5 },
    { time: 2000, owner: 'bot:a', name: 'Alpha', input: 0, cacheRead: 20, cacheWrite: 0, output: 1 },
    { time: 3000, owner: 'room:r', name: 'Group', input: 7, cacheRead: 0, cacheWrite: 0, output: 2 },
  ]
  const usage = aggregateUsage(rows)
  assert.equal(usage.owners.length, 2)
  assert.equal(usage.owners[0].name, 'Alpha')
  assert.equal(usage.owners[0].tokens, 36)
  assert.equal(usage.owners[0].spanMs, 1000)
  assert.equal(usage.owners[1].kind, 'group')
  assert.equal(usage.totals.tokens, 45)
  assert.equal(usage.totals.calls, 3)
  assert.equal(usage.totals.spanMs, 2000)
  assert.equal(usage.totals.spanSumMs, 1000)
})

test('aggregateUsage filters by since and falls back to the owner key', () => {
  const rows = [
    { time: 1000, owner: 'bot:a', name: 'Alpha', input: 10, output: 0 },
    { time: 3000, owner: 'other', name: '', input: 4, output: 1 },
  ]
  const usage = aggregateUsage(rows, { since: 2000 })
  assert.equal(usage.owners.length, 1)
  assert.equal(usage.owners[0].key, 'other')
  assert.equal(usage.owners[0].name, 'other')
  assert.equal(usage.owners[0].kind, 'other')
  assert.equal(usage.totals.tokens, 5)
})

test('withDailyLimit marks the configured threshold', () => {
  const usage = { ok: true, today: { tokens: 120 } }
  assert.equal(withDailyLimit(usage, 100).daily.exceeded, true)
  assert.equal(withDailyLimit(usage, 200).daily.exceeded, false)
  assert.equal(withDailyLimit(usage, 0).daily.exceeded, false)
  assert.equal(withDailyLimit({ ok: false }, 100).ok, false)
})


test('newerVersion compares semver cores', () => {
  assert.equal(newerVersion('0.3.0', '0.2.0'), true)
  assert.equal(newerVersion('v0.2.1', '0.2.0'), true)
  assert.equal(newerVersion('0.2.0', '0.2.0'), false)
  assert.equal(newerVersion('0.1.9', '0.2.0'), false)
  assert.equal(newerVersion('1.0.0', '0.9.9'), true)
})

test('disk targets keep user data out of the safe list', () => {
  const targets = diskTargets()
  const byId = new Map(targets.map(target => [target.id, target]))
  assert.equal(byId.get('dsh').safe, false)
  assert.equal(byId.get('cursor').safe, false)
  assert.equal(byId.get('ollama').safe, false)
  assert.equal(byId.get('playwright').safe, true)
  const safePaths = targets.filter(target => target.safe).map(target => target.path)
  assert.equal(safePaths.includes(byId.get('dsh').path), false)
  assert.equal(safePaths.includes(byId.get('cursor').path), false)
})

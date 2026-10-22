import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBalance, normalizeConfig, parseCredentialRefs, tokenMatches } from '../index.js'

test('normalizeConfig fills safe defaults', () => {
  const config = normalizeConfig()
  assert.equal(config.apiKeyEnv, 'DEEPSEEK_API_KEY')
  assert.equal(config.baseUrl, 'https://api.deepseek.com')
  assert.equal(config.refreshSeconds, 30)
  assert.equal(config.lowBalanceThreshold, 5)
  assert.equal(config.position, 'bottom-right')
  assert.equal(config.locale, 'auto')
})

test('normalizeConfig clamps refresh and threshold', () => {
  assert.equal(normalizeConfig({ refreshSeconds: 1 }).refreshSeconds, 10)
  assert.equal(normalizeConfig({ refreshSeconds: 9999 }).refreshSeconds, 600)
  assert.equal(normalizeConfig({ lowBalanceThreshold: -3 }).lowBalanceThreshold, 0)
  assert.equal(normalizeConfig({ lowBalanceThreshold: '2.5' }).lowBalanceThreshold, 2.5)
  assert.equal(normalizeConfig({ lowBalanceThreshold: 'nope' }).lowBalanceThreshold, 5)
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

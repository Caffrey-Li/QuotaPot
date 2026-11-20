import assert from 'node:assert/strict'
import { apply } from './index.mjs'

let route
apply({
  get: () => undefined,
  effect: (activate) => activate(),
  connection: {
    rpc: {
      intercept() {
        throw new Error('connection: shared RPC channel "/api" already has an interceptor')
      },
    },
    fetch: {
      register(value) { route = value },
    },
  },
})

assert.equal(route.path, '/api/quotapot/request')
assert.deepEqual(route.methods, ['POST'])
assert.equal(route.requestBody, 'buffered')
const request = (method, payload) => route.fetch(new Request('http://localhost' + route.path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'regression', method, payload }),
}))
const response = await request('quotapot/request', { method: 'GET', url: '/api/plugin-panel' })
assert.equal(response.status, 200)
const message = await response.json()
assert.equal(message.type, 'server-response')
assert.equal(message.rpcId, 'regression')
assert.equal(message.result.ok, true)
assert.match(message.result.value.contentType, /text\/html/)
assert.match(message.result.value.body, /<title>QuotaPot<\/title>/)
assert.equal((await request('another/request', {})).status, 400)
const rejected = await request('quotapot/request', { method: 'POST', url: '/api/ports/cursor/open' })
assert.equal((await rejected.json()).result.error.code, 'bad-request')
console.log('quotapot DSH panel check ok')

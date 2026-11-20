import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quotapot-disk-'))
const originalHomedir = os.homedir
const testEnv = {
  PATH: testHome,
  DSH_HOME: path.join(testHome, '.dsh'),
  APPDATA: path.join(testHome, 'roaming'),
  LOCALAPPDATA: path.join(testHome, 'local'),
}
const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]))
try {
  const cache = path.join(testEnv.DSH_HOME, 'cache')
  const external = path.join(testHome, 'outside')
  fs.mkdirSync(cache, { recursive: true })
  fs.mkdirSync(external)
  fs.writeFileSync(path.join(testEnv.DSH_HOME, 'test.data'), Buffer.alloc(1500))
  fs.writeFileSync(path.join(cache, '缓存 test.data'), Buffer.alloc(2500))
  fs.writeFileSync(path.join(external, 'test.data'), Buffer.alloc(8000))
  fs.symlinkSync(external, path.join(cache, 'external'), 'junction')
  os.homedir = () => testHome
  Object.assign(process.env, testEnv)

  const scan = await request('quotapot/request', { method: 'GET', url: '/api/disk/stream' })
  const result = (await scan.json()).result
  assert.equal(result.value.status, 200)
  const events = result.value.body.trim().split('\n\n').map((line) => JSON.parse(line.slice(6)))
  const disk = events.find((event) => event.type === 'done')?.disk
  assert.equal(disk?.ok, true)
  const root = disk.items.find((item) => item.id === 'dsh')
  const child = disk.items.find((item) => item.id === 'dsh-cache')
  assert.equal(root?.size, 4000, 'Scan must return sizes without du')
  assert.equal(child?.size, 2500, 'Linked directories must not contribute to size')
  assert.equal(child?.parent, 'dsh', 'Cache must stay grouped under the DS Bot directory')
} finally {
  os.homedir = originalHomedir
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(testHome, { recursive: true, force: true })
}
console.log('quotapot DSH panel check ok')

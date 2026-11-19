import { Readable } from 'node:stream'
import { createRequestHandler } from '../desktop.mjs'
import { installedPorts } from '../ports/registry.mjs'
import { createUpdater } from './update.mjs'

export const name = 'quotapot'
export const inject = ['connection']

const ENDPOINT = 'quotapot/request'
const PORT_GET = /^\/api\/ports\/[a-z0-9-]+\/(?:usage\/stream|context\/stream|menu|models|headers)$/
const PORT_POST = /^\/api\/ports\/[a-z0-9-]+\/(?:prompts|paste|spawn|open)$/

function permitted(method, pathname) {
  if (method === 'GET') {
    return ['/api/plugin-panel', '/api/ports', '/api/update', '/api/disk', '/api/disk/stream'].includes(pathname) ||
      PORT_GET.test(pathname)
  }
  return method === 'POST' && pathname !== '/api/ports/cursor/open' &&
    (['/api/update/install', '/api/disk/clean'].includes(pathname) || PORT_POST.test(pathname))
}

function describePorts() {
  return installedPorts().map((port) => port.id === 'cursor' ? {
    ...port,
    capabilities: { ...port.capabilities, actions: { ...port.capabilities.actions, open: false } },
  } : port)
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

export function apply(ctx) {
  const updater = createUpdater(() => ctx.get('pluginManager'))
  const handle = createRequestHandler({
    checkForUpdate: updater.check,
    applyUpdate: updater.install,
    describePorts,
  })
  ctx.effect(() => ctx.connection.rpc.intercept('/api', (endpoint) => endpoint === ENDPOINT,
    async (_endpoint, payload, _signal, peer) => {
      if (peer.principal.kind !== 'owner') return failure('forbidden', '需要本机所有者权限')
      const { method, url, body = '' } = payload ?? {}
      if (typeof url !== 'string' || !url.startsWith('/api/') || url.length > 500 ||
          typeof body !== 'string' || Buffer.byteLength(body) > 64_000) {
        return failure('bad-request', '请求格式无效')
      }
      const { pathname } = new URL(url, 'http://localhost')
      if (!permitted(method, pathname)) return failure('bad-request', '此操作在 DSH 面板中不可用')

      const request = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, url: pathname === '/api/plugin-panel' ? '/' : url })
      let status = 500
      let headers = {}
      const chunks = []
      const response = {
        headersSent: false,
        writeHead(code, values = {}) {
          status = code
          headers = values
          this.headersSent = true
        },
        write(chunk) { chunks.push(chunk) },
        end(chunk) { if (chunk) chunks.push(chunk) },
      }
      await handle(request, response)
      return { ok: true, value: {
        status,
        contentType: headers['content-type'] ?? 'text/plain',
        body: chunks.join(''),
      } }
    }), 'QuotaPot panel RPC')
}

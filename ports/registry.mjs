import * as cursor from './cursor/index.mjs'
import * as claude from './claude/index.mjs'
import * as codex from './codex/index.mjs'
import * as dsh from './dsh/index.mjs'
import * as workbuddy from './workbuddy/index.mjs'
import * as grok from './grok/index.mjs'

export const ports = [cursor, claude, codex, dsh, workbuddy, grok]

export function describe(port) {
  const found = port.discover()
  return {
    id: port.id,
    name: port.name,
    installed: Boolean(found.installed),
    capabilities: port.capabilities,
    prompt: port.promptProfile,
  }
}

export function getPort(portId) {
  return ports.find((port) => port.id === portId) || null
}

export function installedPorts() {
  return ports.filter((port) => port.discover().installed).map(describe)
}

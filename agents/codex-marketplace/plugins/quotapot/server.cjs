'use strict'

// Codex plugin: a minimal MCP stdio server exposing QuotaPot data as tools.
const readline = require('node:readline')
const core = require('./core.cjs')

const VERSION = '0.1.0'
const TOOLS = [
  {
    name: 'quotapot_status',
    description: 'DeepSeek balance, Cursor usage and local Codex usage in one call.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'quotapot_balance',
    description: 'DeepSeek account balance. Needs DEEPSEEK_API_KEY in the plugin environment.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'quotapot_cursor_usage',
    description: 'Cursor current billing-period usage, read through Cursor\'s local login token.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'quotapot_codex_usage',
    description: 'Codex token totals and rate limits parsed from ~/.codex/sessions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function deepseekOptions() {
  const local = core.localConfig()
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || local.deepseekApiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || local.deepseekBaseUrl,
  }
}

async function callTool(name) {
  if (name === 'quotapot_status') {
    return core.status({
      ...deepseekOptions(),
      cursorBaseUrl: process.env.CURSOR_API_BASE_URL,
    })
  }
  if (name === 'quotapot_balance') return core.deepseekBalance(deepseekOptions())
  if (name === 'quotapot_cursor_usage') {
    return core.cursorUsage({ baseUrl: process.env.CURSOR_API_BASE_URL })
  }
  if (name === 'quotapot_codex_usage') return core.codexUsage()
  throw new Error(`Unknown tool: ${name}`)
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', async line => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (!message || message.jsonrpc !== '2.0') return
  const { id, method, params } = message
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'quotapot', version: VERSION },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'ping') { result(id, {}); return }
  if (method === 'tools/list') { result(id, { tools: TOOLS }); return }
  if (method === 'tools/call') {
    const name = params?.name
    try {
      const data = await callTool(name)
      result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
    } catch (error) {
      result(id, { content: [{ type: 'text', text: `QuotaPot error: ${error && error.message ? error.message : error}` }], isError: true })
    }
    return
  }
  if (id !== undefined) failure(id, -32601, `Method not found: ${method}`)
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

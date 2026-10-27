// Run on the Mac: node ports/claude/probe.mjs
// Prints field names, counts and totals only. No message text, titles, paths, tokens or emails.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverAt, listJsonl, listSessionFiles, parseLine, paths, sessionMeta, sessionTrend, tallyFiles, usageOf } from './index.mjs'

const where = paths()
const found = discoverAt(where)
const out = { claudeCode: found.code }

if (found.code) {
  const files = listJsonl(where.projectsDir, 0)
  out.jsonlFiles = files.length
  out.subagentFiles = files.filter((item) => item.file.includes(path.sep + 'subagents' + path.sep)).length
  out.totalMB = Math.round(files.reduce((sum, item) => sum + item.size, 0) / 1048576)
  const types = {}
  const systemSubtypes = {}
  const usageKeys = new Set()
  const compactKeys = new Set()
  const titleTypes = {}
  const topKeys = new Set()
  let assistantLines = 0
  let ids = new Map()
  let differingOutput = 0
  let withoutId = 0
  let badLines = 0
  let durationFields = new Set()
  const recent = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 40)
  for (const item of recent) {
    for (const line of fs.readFileSync(item.file, 'utf8').split('\n')) {
      if (!line) continue
      const entry = parseLine(line)
      if (!entry) { badLines += 1; continue }
      for (const key of Object.keys(entry)) topKeys.add(key)
      types[entry.type] = (types[entry.type] || 0) + 1
      if (entry.type === 'system') systemSubtypes[entry.subtype || '(none)'] = (systemSubtypes[entry.subtype || '(none)'] || 0) + 1
      if (entry.type === 'system' && entry.subtype === 'compact_boundary') for (const key of Object.keys(entry.compactMetadata || {})) compactKeys.add(key)
      if (!['user', 'assistant', 'system'].includes(entry.type)) titleTypes[entry.type] = Object.keys(entry).filter((key) => !['type', 'uuid', 'sessionId', 'timestamp'].includes(key)).sort().join(',')
      for (const key of Object.keys(entry)) if (/duration|latency|elapsed|ms$/i.test(key)) durationFields.add(key)
      if (entry.type === 'assistant') {
        assistantLines += 1
        for (const key of Object.keys(entry.message?.usage || {})) usageKeys.add(key)
        const usage = usageOf(entry)
        if (!entry.message?.id) withoutId += 1
        if (usage) {
          const previous = ids.get(usage.key)
          if (previous != null && previous !== usage.output) differingOutput += 1
          ids.set(usage.key, usage.output)
        }
      }
    }
  }
  Object.assign(out, {
    sampledSessions: recent.length,
    lineTypes: types,
    systemSubtypes,
    otherLineTypesAndKeys: titleTypes,
    topLevelKeys: [...topKeys].sort(),
    usageKeys: [...usageKeys].sort(),
    compactMetadataKeys: [...compactKeys].sort(),
    durationLikeFields: [...durationFields].sort(),
    assistantLines,
    uniqueMessages: ids.size,
    duplicateLinesWithDifferentOutput: differingOutput,
    assistantLinesWithoutMessageId: withoutId,
    unparsableLines: badLines,
  })
  const day = new Date(); day.setHours(0, 0, 0, 0)
  for (const days of [1, 7, 30]) {
    const start = day.getTime() - (days - 1) * 86_400_000
    const result = tallyFiles(listJsonl(where.projectsDir, start), start)
    out['usage' + days] = { tokens: result.tokens, calls: result.calls, models: result.models.map((row) => row.model + ':' + row.tokens) }
  }
  const sessions = listSessionFiles(where.projectsDir, 20)
  out.sessions = sessions.map((item) => {
    const meta = sessionMeta(item)
    const row = { hasName: Boolean(meta.name), hasWorkspace: Boolean(meta.workspace), model: meta.model, used: meta.used, limit: meta.limit, percent: meta.percent }
    if (meta.percent >= 60) {
      const trend = sessionTrend(item)
      Object.assign(row, { samples: trend.samples, boundaries: trend.boundaries, compactions: trend.compactions, maxUsed: trend.maxUsed })
    }
    return row
  })
}
console.log(JSON.stringify(out, null, 2))

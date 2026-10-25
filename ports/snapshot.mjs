import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SNAPSHOT_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'QuotaPot', 'snapshot.json')
let snapshotState = null

export function snapshot() {
  if (snapshotState) return snapshotState
  try {
    snapshotState = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
  } catch {
    snapshotState = {}
  }
  return snapshotState
}

export function persistSnapshot() {
  const dir = path.dirname(SNAPSHOT_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${SNAPSHOT_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(snapshot()))
  fs.renameSync(tmp, SNAPSHOT_PATH)
}

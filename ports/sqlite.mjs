import { DatabaseSync } from 'node:sqlite'

export function openRead(file) {
  return new DatabaseSync(file, { readOnly: true, timeout: 8000 })
}

export function openWrite(file) {
  return new DatabaseSync(file, { timeout: 8000 })
}

export function textRows(db, sql, params = []) {
  return db.prepare(sql).all(...params).map((row) => {
    const value = Object.values(row)[0]
    return value == null ? '' : String(value)
  }).join('\n')
}

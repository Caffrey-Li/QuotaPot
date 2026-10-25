export function degrade(reason) {
  return { ok: false, degraded: true, reason: String(reason || '这项数据读不到') }
}

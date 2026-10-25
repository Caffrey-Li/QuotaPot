export const CONTEXT_WARN_PERCENT = 80

// Two more task turns after a tidy, each adding the 40k jump measured on local chats.
// Savings = (turns - 1) * used - sum(summary + growth * i). 80% of 256k clears 100k; 50% does not.
export function contextSave(used, turns = 2, growth = 40_000, summary = 8_000) {
  let fresh = 0
  for (let index = 0; index < turns; index += 1) fresh += summary + growth * index
  return turns * used - used - fresh
}

export function contextTrend(samples) {
  const points = (Array.isArray(samples) ? samples : [])
    .map((item) => ({ at: Number(item.at) || 0, used: Number(item.used) || 0 }))
    .filter((item) => item.used > 0)
    .sort((a, b) => a.at - b.at)
  let compactions = 0
  let lostSum = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].used
    const next = points[index].used
    if (previous > 0 && next < previous * 0.8) {
      compactions += 1
      lostSum += (previous - next) / previous
    }
  }
  const first = points[0]?.used || 0
  const last = points.at(-1)?.used || 0
  return {
    compactions,
    lostRatio: compactions ? lostSum / compactions : null,
    growth: points.length >= 2 && first > 0 ? (last - first) / first : null,
  }
}

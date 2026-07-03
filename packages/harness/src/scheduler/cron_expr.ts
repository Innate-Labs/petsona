// 5 段 cron 匹配（分 时 日 月 周）。为什么自己写：仓库零运行时第三方依赖的惯例，
// 需求只有 * , - */n 与标准「日/周同时受限取 OR」，~80 行可控。

type FieldRange = { min: number; max: number }
const FIELDS: FieldRange[] = [
  { min: 0, max: 59 },  // minute
  { min: 0, max: 23 },  // hour
  { min: 1, max: 31 },  // day of month
  { min: 1, max: 12 },  // month
  { min: 0, max: 7 },   // day of week（0 与 7 都是周日）
]

/** 解析单字段为命中集合；非法返回 null */
function parseField(spec: string, range: FieldRange): Set<number> | null {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const step = m[2] ? parseInt(m[2], 10) : 1
    if (step < 1) return null
    let lo: number, hi: number
    if (m[1] === '*') {
      lo = range.min; hi = range.max
    } else if (m[1]!.includes('-')) {
      const [a, b] = m[1]!.split('-').map((x) => parseInt(x, 10))
      lo = a!; hi = b!
    } else {
      lo = hi = parseInt(m[1]!, 10)
      if (m[2]) hi = range.max          // "5/15" 视为 5 起步进（标准行为）
    }
    if (lo < range.min || hi > range.max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size > 0 ? out : null
}

function parse(expr: string): Set<number>[] | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets: Set<number>[] = []
  for (let i = 0; i < 5; i++) {
    const s = parseField(parts[i]!, FIELDS[i]!)
    if (!s) return null
    sets.push(s)
  }
  return sets
}

export function isValidCron(expr: string): boolean {
  return parse(expr) !== null
}

export function cronMatches(expr: string, date: Date): boolean {
  const sets = parse(expr)
  if (!sets) return false
  const [min, hour, dom, mon, dow] = sets
  if (!min!.has(date.getMinutes()) || !hour!.has(date.getHours()) || !mon!.has(date.getMonth() + 1)) return false
  const domHit = dom!.has(date.getDate())
  const dowHit = dow!.has(date.getDay()) || (dow!.has(7) && date.getDay() === 0)
  // 标准 cron：日与周都非 * 时取 OR，否则取 AND（即都得命中，* 恒命中）
  const domAny = dom!.size === FIELDS[2]!.max - FIELDS[2]!.min + 1
  const dowAny = dow!.size >= 7
  if (!domAny && !dowAny) return domHit || dowHit
  return domHit && dowHit
}

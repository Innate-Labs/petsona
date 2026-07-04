// 治理：限流 / 日预算熔断 / 子任务 token 记账（v3.0 §3.2 治理硬约束，网关侧不信客户端）
// SPEC-GAP: v2.1 §2.4 指定 Redis 承载限流与用量（REDIS_URL），桌面 M1 单实例网关先用
// 内存实现，键名保持 rate:chat:min|day:{userId} 语义，后续换 Redis 只改本文件。

import { env } from './env.js'

// —— 限流：分钟滑动窗口 + 日计数 ——
const minuteHits = new Map<string, number[]>()          // rate:chat:min:{userId}
const dayCounts = new Map<string, number>()             // rate:chat:day:{userId}:{yyyy-mm-dd}
const authHourHits = new Map<string, number[]>()        // rate:auth:hour:{ip}

// —— 用量 ledger：预算与任务记账共用（导出给限流/预算用）——
const dayUsage = new Map<string, { in: number; out: number; usd: number }>()   // usage:{yyyy-mm-dd}（全局日预算）
const taskTokens = new Map<string, number>()            // task:{taskId} 累计 in+out

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function slideWindow(store: Map<string, number[]>, key: string, windowMs: number): number[] {
  const now = Date.now()
  // 为什么 >=0：同一毫秒内的多次命中必须保留，否则快速连打会绕过限流
  const arr = (store.get(key) ?? []).filter((t) => now - t >= 0 && now - t < windowMs)
  store.set(key, arr)
  return arr
}

export type RateResult = { ok: true } | { ok: false; reason: 'min' | 'day' }

export function checkAndCountChat(userId: string): RateResult {
  const minKey = `rate:chat:min:${userId}`
  const minArr = slideWindow(minuteHits, minKey, 60_000)
  if (minArr.length >= env.rateChatPerMin()) return { ok: false, reason: 'min' }

  const dayKey = `rate:chat:day:${userId}:${today()}`
  const dayN = dayCounts.get(dayKey) ?? 0
  if (dayN >= env.rateChatPerDay()) return { ok: false, reason: 'day' }

  minArr.push(Date.now())
  dayCounts.set(dayKey, dayN + 1)
  return { ok: true }
}

export function checkAndCountAuthCode(ip: string): boolean {
  const arr = slideWindow(authHourHits, `rate:auth:hour:${ip}`, 3_600_000)
  if (arr.length >= env.rateAuthPerHour()) return false
  arr.push(Date.now())
  return true
}

// —— 日预算熔断（budget:daily:usd）：tokens × 单价估算，超 BUDGET_DAILY_USD 拒绝 ——
export function checkDailyBudget(): boolean {
  const u = dayUsage.get(`usage:${today()}`)
  return (u?.usd ?? 0) < env.budgetDailyUsd()
}

export function recordUsage(usage: { in: number; out: number }, taskId?: string): void {
  const key = `usage:${today()}`
  const u = dayUsage.get(key) ?? { in: 0, out: 0, usd: 0 }
  u.in += usage.in
  u.out += usage.out
  u.usd += (usage.in * env.priceInPerMTok() + usage.out * env.priceOutPerMTok()) / 1_000_000
  dayUsage.set(key, u)
  if (taskId) taskTokens.set(taskId, (taskTokens.get(taskId) ?? 0) + usage.in + usage.out)
}

// —— 子任务预算：meta.loop=subagent 时按 taskId 累计（v3.0 §3.2 TASK_BUDGET_EXCEEDED）——
// 阈值随请求 meta 上报（Config.taskBudget.maxTokens），以网关 TASK_MAX_TOKENS 为上限封顶。
export function checkTaskBudget(taskId: string, requestedMax?: number): { ok: boolean; used: number; limit: number } {
  const cap = env.taskMaxTokens()
  const limit = requestedMax !== undefined ? Math.min(requestedMax, cap) : cap
  const used = taskTokens.get(taskId) ?? 0
  return { ok: used < limit, used, limit }
}

export function getDayUsage(): { in: number; out: number; usd: number } {
  return dayUsage.get(`usage:${today()}`) ?? { in: 0, out: 0, usd: 0 }
}

// 测试用：清空全部治理状态（内存实现的必要出口）
export function resetGovernance(): void {
  minuteHits.clear()
  dayCounts.clear()
  authHourHits.clear()
  dayUsage.clear()
  taskTokens.clear()
}

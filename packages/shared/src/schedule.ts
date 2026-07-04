// §3.8 调度与注入（s14 + p01/p02）

export type CronJobKind = 'pomodoro' | 'water' | 'stand' | 'dream' | 'anniversary' | 'custom'

export type CronJob = {
  id: string
  cron: string                  // 5 段 cron
  kind: CronJobKind
  payload?: object
  durable: boolean
  lastFiredAt?: number
}

export type InjectionSource = 'task' | 'cron' | 'heartbeat' | 'system'

export type InjectionItem = {
  source: InjectionSource
  priority: 1 | 2 | 3           // 1=任务结果 2=提醒 3=闲聊
  content: string               // 已含 XML 包裹，如 <task-result>…
  dedupeKey?: string
  expiresAt?: number
}

export const SCHEDULER_TICK_MS = 30_000       // 调度线程每 30s 检查 scheduled.json
export const INJECTION_MAX_PER_TURN = 3       // 单轮最多注入 3 条
export const DREAM_CRON = '30 3 * * *'        // 每日 03:30
export const DREAM_CATCHUP_HOURS = 20         // 错过 >20h 才补跑，防重复
// SPEC-GAP: 规格未定义提醒条目滞留上限；全屏/勿扰压住 10 分钟后直接过期丢弃，避免堆积轰炸
export const REMINDER_EXPIRES_MS = 10 * 60_000

// 提醒消费器（§3.8「陪伴循环空闲时消费」+ 架构 §4.2 文案池直出档）：
// 为什么不进 LLM——提醒要准点、零延迟、零幻觉；LLM 注入留给任务结果/纪念日这类要人格化播报的条目。

import type { Config } from '@petsona/shared'
import { IPC, TRACK } from '@petsona/shared'
import type { InjectionQueue } from './injection_queue.js'
import type { FallbackPool } from '../persona/fallback_pool.js'
import { inQuietHours } from '../scheduler/guards.js'

export const CONSUMER_TICK_MS = 5_000   // SPEC-GAP: 消费轮询间隔规格未定，5s 满足「准点」感知

export type ConsumerDeps = {
  queue: InjectionQueue
  pool: FallbackPool
  getConfig: () => Config
  getFullscreen: () => boolean
  isLoopBusy: () => boolean
  emit: (e: { type: string; payload: unknown }) => void
  track: (eventId: number, props: Record<string, unknown>) => void
  now?: () => number
}

const REMINDER_RE = /^<reminder kind="(\w+)"(?: phase="(\w+)")?\/>$/

export class ReminderConsumer {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number

  constructor(private deps: ConsumerDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), CONSUMER_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  tick(): void {
    if (this.deps.isLoopBusy()) return   // 陪伴循环空闲时才消费
    const now = this.now()
    const items = this.deps.queue.drainWhere((i) => i.content.startsWith('<reminder '), now)
    if (!items.length) return
    const p = this.deps.getConfig().proactive
    const muted = (p.fullscreenMute && this.deps.getFullscreen()) || inQuietHours(new Date(now), p.quietHours)
    for (const item of items) {
      if (muted) { this.deps.queue.push(item); continue }   // 押回，expiresAt 到点自然丢弃
      const m = REMINDER_RE.exec(item.content)
      if (!m) continue   // 形状不对直接丢（生产方约定见 CronScheduler.pushReminder）
      const [, kind, phase] = m
      const petLine = this.deps.pool.pick(phase ? `reminder_${kind}_${phase}` : `reminder_${kind}`)
      this.deps.emit({ type: IPC.REMINDER_FIRED, payload: { kind, phase, petLine } })
      this.deps.emit({ type: IPC.PET_BUBBLE, payload: { text: petLine, durationMs: 8000, kind: 'reminder' } })
      this.deps.track(TRACK.提醒_触发, { kind, phase: phase ?? '' })
    }
  }
}

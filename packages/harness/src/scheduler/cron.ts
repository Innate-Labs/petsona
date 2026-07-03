// s14 调度器（§3.8）：30s tick 读 scheduled.json → InjectionItem 入队。
// 硬边界：不 import gateway、不 emit——到点只生产队列条目或调 onDream 回调（结构测试强制）。

import type { Config, CronJob, ReminderKind } from '@petsona/shared'
import { DREAM_CATCHUP_HOURS, DREAM_CRON, REMINDER_EXPIRES_MS, SCHEDULER_TICK_MS } from '@petsona/shared'
import type { InjectionQueue } from '../loop/injection_queue.js'
import { cronMatches } from './cron_expr.js'
import { loadJobs, saveJobs } from './jobs_store.js'

// SPEC-GAP: 5 段 cron 表达不了「每 45 分钟」类任意间隔；water/stand/pomodoro 走
// lastFiredAt + 间隔的到期判定，间隔从 config（water/stand 实时读）或 payload（pomodoro 会话内）取
type PomodoroPayload = { focusMin: number; restMin: number; phase: 'focus' | 'rest'; count: number }

export type SchedulerDeps = {
  jobsPath: string
  queue: InjectionQueue
  getConfig: () => Config
  onDream: () => Promise<void>
  now?: () => number
}

export class CronScheduler {
  private list: CronJob[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number

  constructor(private deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.list = loadJobs(this.deps.jobsPath)
    this.ensureDream()
    this.tick()
    this.timer = setInterval(() => this.tick(), SCHEDULER_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  jobs(): CronJob[] {
    return this.list.map((j) => ({ ...j }))
  }

  tick(): void {
    const now = this.now()
    let dirty = false
    for (const job of this.list) {
      if (!this.due(job, now)) continue
      this.fire(job, now)
      job.lastFiredAt = now
      dirty = dirty || job.durable
    }
    if (dirty) this.persist()
  }

  setReminder(kind: ReminderKind, cfg?: object): void {
    this.list = this.list.filter((j) => j.kind !== kind)   // 同 kind 只一个
    const now = this.now()
    if (kind === 'pomodoro') {
      const base = this.deps.getConfig().reminders.pomodoro
      const c = { ...base, ...(cfg as Partial<PomodoroPayload> | undefined) }
      const payload: PomodoroPayload = { focusMin: c.focusMin, restMin: c.restMin, phase: 'focus', count: 0 }
      // SPEC-GAP: 番茄钟是会话态，重启后不恢复（durable=false）——中断的专注段没有意义
      this.list.push({ id: 'pomodoro', cron: '', kind, payload, durable: false, lastFiredAt: now })
      this.pushReminder('pomodoro', 'focus_start', now)
    } else {
      this.list.push({ id: kind, cron: '', kind, durable: true, lastFiredAt: now })
    }
    this.persist()
  }

  stopReminder(kind: ReminderKind): void {
    const existed = this.list.some((j) => j.kind === kind)
    this.list = this.list.filter((j) => j.kind !== kind)
    if (kind === 'pomodoro' && existed) this.pushReminder('pomodoro', 'abort', this.now())
    this.persist()
  }

  // ---- 内部 ----

  private due(job: CronJob, now: number): boolean {
    if (job.kind === 'pomodoro' || job.kind === 'water' || job.kind === 'stand') {
      return now - (job.lastFiredAt ?? 0) >= this.intervalMin(job) * 60_000
    }
    // cron 类（dream/anniversary/custom）：命中当前分钟且本分钟未触发过（tick 每 30s 会进两次）
    const minuteStart = Math.floor(now / 60_000) * 60_000
    return cronMatches(job.cron, new Date(now)) && (job.lastFiredAt ?? 0) < minuteStart
  }

  private intervalMin(job: CronJob): number {
    const cfg = this.deps.getConfig()
    if (job.kind === 'water') return cfg.reminders.waterMin
    if (job.kind === 'stand') return cfg.reminders.standMin
    const p = job.payload as PomodoroPayload
    return p.phase === 'focus' ? p.focusMin : p.restMin
  }

  private fire(job: CronJob, now: number): void {
    switch (job.kind) {
      case 'dream':
        void this.deps.onDream().catch((err) => console.error('[scheduler] dream 失败:', err))
        return
      case 'pomodoro': {
        const p = job.payload as PomodoroPayload
        this.pushReminder('pomodoro', p.phase === 'focus' ? 'focus_end' : 'rest_end', now)
        job.payload = p.phase === 'focus'
          ? { ...p, phase: 'rest', count: p.count + 1 }
          : { ...p, phase: 'focus' }
        return
      }
      case 'water':
      case 'stand':
        this.pushReminder(job.kind, undefined, now)
        return
      default: {   // anniversary / custom：进 LLM 注入（下一轮对话第一句提起，架构 §4.2）
        const note = (job.payload as { note?: string } | undefined)?.note ?? job.id
        const minuteStart = Math.floor(now / 60_000) * 60_000
        this.deps.queue.push({
          source: 'cron', priority: 2,
          content: `<cron-reminder kind="${job.kind}">${note}</cron-reminder>`,
          dedupeKey: `cron:${job.id}:${minuteStart}`,
          expiresAt: now + 24 * 3600_000,
        })
      }
    }
  }

  private pushReminder(kind: ReminderKind, phase: string | undefined, now: number): void {
    this.deps.queue.push({
      source: 'cron', priority: 2,
      content: phase ? `<reminder kind="${kind}" phase="${phase}"/>` : `<reminder kind="${kind}"/>`,
      // 常量 dedupeKey：静默压住的旧提醒还没消费时不再堆新的（回来只看到一条）
      dedupeKey: phase ? `reminder:${kind}:${phase}` : `reminder:${kind}`,
      expiresAt: now + REMINDER_EXPIRES_MS,
    })
  }

  private ensureDream(): void {
    let dream = this.list.find((j) => j.kind === 'dream')
    if (!dream) {
      // lastFiredAt 初始化为 now：首装不把「从未跑过」当成错过（补跑只针对真正错过的 03:30）
      dream = { id: 'dream', cron: DREAM_CRON, kind: 'dream', durable: true, lastFiredAt: this.now() }
      this.list.push(dream)
      this.persist()
      return
    }
    if (this.now() - (dream.lastFiredAt ?? 0) > DREAM_CATCHUP_HOURS * 3600_000) {
      void this.deps.onDream().catch((err) => console.error('[scheduler] dream 补跑失败:', err))
      dream.lastFiredAt = this.now()
      this.persist()
    }
  }

  private persist(): void {
    try {
      saveJobs(this.deps.jobsPath, this.list)
    } catch (err) {
      console.error('[scheduler] scheduled.json 落盘失败:', err)
    }
  }
}

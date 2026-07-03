// §3.8：30s tick 读 scheduled.json → InjectionItem 入队；调度器不调 LLM、不发气泡
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, DREAM_CATCHUP_HOURS } from '@petsona/shared'
import { InjectionQueue } from '../../packages/harness/src/loop/injection_queue.js'
import { CronScheduler } from '../../packages/harness/src/scheduler/cron.js'
import { loadJobs, saveJobs } from '../../packages/harness/src/scheduler/jobs_store.js'

const MIN = 60_000
let queue: InjectionQueue
let jobsPath: string
let clock: number
let dreamRuns: number

function makeScheduler() {
  return new CronScheduler({
    jobsPath, queue,
    getConfig: () => DEFAULT_CONFIG,
    onDream: async () => { dreamRuns++ },
    now: () => clock,
  })
}

beforeEach(() => {
  queue = new InjectionQueue()
  jobsPath = join(mkdtempSync(join(tmpdir(), 'petsona-cron-')), 'scheduled.json')
  clock = new Date('2026-07-03T12:00:00').getTime()
  dreamRuns = 0
})

describe('CronScheduler', () => {
  it('start 确保 dream 任务存在且 lastFiredAt 初始化为 now（首装不补跑）', () => {
    const s = makeScheduler()
    s.start(); s.stop()
    const dream = s.jobs().find((j) => j.kind === 'dream')!
    expect(dream.cron).toBe('30 3 * * *')
    expect(dream.lastFiredAt).toBe(clock)
    expect(dreamRuns).toBe(0)
  })
  it('距上次 dream >20h 启动补跑', () => {
    saveJobs(jobsPath, [{ id: 'dream', cron: '30 3 * * *', kind: 'dream', durable: true,
      lastFiredAt: clock - (DREAM_CATCHUP_HOURS + 1) * 3600_000 }])
    const s = makeScheduler()
    s.start(); s.stop()
    expect(dreamRuns).toBe(1)
  })
  it('cron 任务到点触发一次，同一分钟第二次 tick 不重复', () => {
    saveJobs(jobsPath, [{ id: 'anniv', cron: '0 12 * * *', kind: 'anniversary', durable: true,
      payload: { note: '陪伴 100 天' }, lastFiredAt: 0 }])
    const s = makeScheduler()
    s.start(); s.stop()   // start 载盘并立即 tick 一次（12:00 命中）
    s.tick()              // 同一分钟第二次 tick（模拟 30s 间隔）不重复
    // drainWhere 必须传假时钟：默认 Date.now() 会把假时钟打的 expiresAt 判成已过期（时段性 flake）
    const items = queue.drainWhere(() => true, clock)
    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('陪伴 100 天')
    expect(items[0]!.content).toMatch(/^<cron-reminder /)
  })
  it('water 间隔任务按 config.reminders.waterMin 触发并产出 <reminder>', () => {
    const s = makeScheduler()
    s.setReminder('water')
    clock += 59 * MIN; s.tick()
    expect(queue.size).toBe(0)
    clock += 1 * MIN; s.tick()
    const items = queue.drainWhere(() => true, clock)
    expect(items[0]!.content).toBe('<reminder kind="water"/>')
    expect(items[0]!.priority).toBe(2)
  })
  it('pomodoro：SET 立即 focus_start，焦点段结束 focus_end，休息段结束 rest_end，STOP 发 abort', () => {
    const s = makeScheduler()
    s.setReminder('pomodoro', { focusMin: 25, restMin: 5 })
    expect(queue.drainWhere(() => true, clock)[0]!.content).toBe('<reminder kind="pomodoro" phase="focus_start"/>')
    clock += 25 * MIN; s.tick()
    expect(queue.drainWhere(() => true, clock)[0]!.content).toBe('<reminder kind="pomodoro" phase="focus_end"/>')
    clock += 5 * MIN; s.tick()
    expect(queue.drainWhere(() => true, clock)[0]!.content).toBe('<reminder kind="pomodoro" phase="rest_end"/>')
    s.stopReminder('pomodoro')
    expect(queue.drainWhere(() => true, clock)[0]!.content).toBe('<reminder kind="pomodoro" phase="abort"/>')
    expect(s.jobs().find((j) => j.kind === 'pomodoro')).toBeUndefined()
  })
  it('water/stand durable 落盘、pomodoro 不落盘；stopReminder 从盘上移除', () => {
    const s = makeScheduler()
    s.setReminder('water'); s.setReminder('pomodoro')
    const onDisk = loadJobs(jobsPath)
    expect(onDisk.map((j) => j.kind)).toContain('water')
    expect(onDisk.map((j) => j.kind)).not.toContain('pomodoro')
    s.stopReminder('water')
    expect(loadJobs(jobsPath).map((j) => j.kind)).not.toContain('water')
  })
  it('dream 到点走 onDream 回调，不入注入队列', () => {
    const s = makeScheduler()
    s.start(); s.stop()
    clock = new Date('2026-07-04T03:30:10').getTime()
    s.tick()
    expect(dreamRuns).toBe(1)
    expect(queue.size).toBe(0)
  })
  it('重复 setReminder 同 kind 只保留一个任务', () => {
    const s = makeScheduler()
    s.setReminder('water'); s.setReminder('water')
    expect(s.jobs().filter((j) => j.kind === 'water')).toHaveLength(1)
  })
})

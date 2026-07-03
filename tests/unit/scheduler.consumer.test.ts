// §3.8 消费侧：调度器只生产，气泡由陪伴循环侧消费器直出（文案池，准点零延迟）
import { beforeEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, type Config } from '@petsona/shared'
import { InjectionQueue } from '../../packages/harness/src/loop/injection_queue.js'
import { FallbackPool } from '../../packages/harness/src/persona/fallback_pool.js'
import { ReminderConsumer } from '../../packages/harness/src/loop/reminder_consumer.js'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../packages/assets/fallback')
const NOON = new Date('2026-07-03T12:00:00').getTime()

let queue: InjectionQueue
let emitted: { type: string; payload: any }[]
let tracked: number[]
let cfg: Config
let fullscreen: boolean
let busy: boolean

function makeConsumer() {
  const pool = new FallbackPool()
  pool.load(ASSETS)
  return new ReminderConsumer({
    queue, pool,
    getConfig: () => cfg,
    getFullscreen: () => fullscreen,
    isLoopBusy: () => busy,
    emit: (e) => emitted.push(e as any),
    track: (id) => tracked.push(id),
    now: () => NOON,
  })
}

beforeEach(() => {
  queue = new InjectionQueue()
  emitted = []; tracked = []
  cfg = { ...DEFAULT_CONFIG, proactive: { frequency: 'mid', quietHours: ['22:00', '09:00'], fullscreenMute: true } }
  fullscreen = false; busy = false
})

const pushWater = () => queue.push({
  source: 'cron', priority: 2, content: '<reminder kind="water"/>',
  dedupeKey: 'reminder:water', expiresAt: NOON + 600_000,
})

describe('ReminderConsumer', () => {
  it('直出 REMINDER_FIRED + PET_BUBBLE(kind reminder) + 埋点 1302', () => {
    pushWater()
    makeConsumer().tick()
    const fired = emitted.find((e) => e.type === 'REMINDER_FIRED')!
    expect(fired.payload.kind).toBe('water')
    expect(typeof fired.payload.petLine).toBe('string')
    const bubble = emitted.find((e) => e.type === 'PET_BUBBLE')!
    expect(bubble.payload.kind).toBe('reminder')
    expect(bubble.payload.text).toBe(fired.payload.petLine)
    expect(tracked).toContain(1302)
  })
  it('phase 条目映射 phase 文案 key', () => {
    queue.push({ source: 'cron', priority: 2, content: '<reminder kind="pomodoro" phase="focus_end"/>',
      dedupeKey: 'reminder:pomodoro:focus_end', expiresAt: NOON + 600_000 })
    makeConsumer().tick()
    const fired = emitted.find((e) => e.type === 'REMINDER_FIRED')!
    expect(fired.payload.phase).toBe('focus_end')
  })
  it('循环忙 → 本 tick 不消费，条目还在', () => {
    busy = true
    pushWater()
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
  it('全屏静默 → 押回队列（不发不丢）', () => {
    fullscreen = true
    pushWater()
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
  it('勿扰时段 → 押回队列', () => {
    cfg = { ...cfg, proactive: { ...cfg.proactive, quietHours: ['00:00', '23:59'] } }
    pushWater()
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
  it('非提醒条目不动（留给 LLM 注入）', () => {
    queue.push({ source: 'task', priority: 1, content: '<task-result/>' })
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
})

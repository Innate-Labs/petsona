// p01 心跳（§3.8）：空闲 ≥ 阈值 → p02 → decide(cheap) → 语义去重 → p02 二次校验 → 发气泡
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type Config } from '@petsona/shared'
import { DECISION_RETRY_MS, Heartbeat } from '../../packages/harness/src/scheduler/heartbeat.js'

const NOON = new Date('2026-07-03T12:00:00').getTime()
let clock: number
let cfg: Config
let spoken: string[]
let decisions: number
let decideResult: string | null
let dupResult: boolean
let statePath: string

function makeHeartbeat() {
  return new Heartbeat({
    getConfig: () => cfg,
    decide: async () => { decisions++; return decideResult },
    isDuplicate: async () => dupResult,
    emitProactive: (t) => spoken.push(t),
    statePath,
    now: () => clock,
  })
}

beforeEach(() => {
  clock = NOON
  cfg = { ...DEFAULT_CONFIG, proactive: { frequency: 'mid', quietHours: ['22:00', '09:00'], fullscreenMute: true } }
  spoken = []; decisions = 0; decideResult = '出来晒晒太阳嘛'; dupResult = false
  statePath = join(mkdtempSync(join(tmpdir(), 'petsona-hb-')), 'proactive.json')
})

describe('Heartbeat p01/p02', () => {
  it('空闲达到阈值（mid=45min）才决策并发气泡，状态落盘', async () => {
    const hb = makeHeartbeat()
    await hb.onIdle({ idleMinutes: 44, fullscreen: false })
    expect(decisions).toBe(0)
    await hb.onIdle({ idleMinutes: 45, fullscreen: false })
    expect(spoken).toEqual(['出来晒晒太阳嘛'])
    const saved = JSON.parse(readFileSync(statePath, 'utf8'))
    expect(saved.lastProactiveAt).toBe(clock)
    expect(saved.recent).toEqual(['出来晒晒太阳嘛'])
  })
  it('frequency=off 不决策', async () => {
    cfg = { ...cfg, proactive: { ...cfg.proactive, frequency: 'off' } }
    await makeHeartbeat().onIdle({ idleMinutes: 999, fullscreen: false })
    expect(decisions).toBe(0)
  })
  it('全屏静默不决策', async () => {
    await makeHeartbeat().onIdle({ idleMinutes: 60, fullscreen: true })
    expect(decisions).toBe(0)
  })
  it('发过一次后 45 分钟内频控拦截', async () => {
    const hb = makeHeartbeat()
    await hb.onIdle({ idleMinutes: 60, fullscreen: false })
    clock += 44 * 60_000
    await hb.onIdle({ idleMinutes: 104, fullscreen: false })
    expect(spoken).toHaveLength(1)
    clock += 1 * 60_000
    await hb.onIdle({ idleMinutes: 105, fullscreen: false })
    expect(spoken).toHaveLength(2)
  })
  it('模型 skip 后 DECISION_RETRY_MS 内不再询问', async () => {
    decideResult = null
    const hb = makeHeartbeat()
    await hb.onIdle({ idleMinutes: 60, fullscreen: false })
    clock += DECISION_RETRY_MS - 1000
    await hb.onIdle({ idleMinutes: 65, fullscreen: false })
    expect(decisions).toBe(1)
    clock += 2000
    await hb.onIdle({ idleMinutes: 65, fullscreen: false })
    expect(decisions).toBe(2)
    expect(spoken).toEqual([])
  })
  it('语义重复 → 不发、不更新 lastProactiveAt', async () => {
    dupResult = true
    await makeHeartbeat().onIdle({ idleMinutes: 60, fullscreen: false })
    expect(spoken).toEqual([])
    expect(existsSync(statePath)).toBe(false)
  })
  it('recent 只保留最近 3 条；重启从盘上恢复频控', async () => {
    const hb = makeHeartbeat()
    for (let i = 0; i < 4; i++) {
      decideResult = `第${i}句`
      await hb.onIdle({ idleMinutes: 60, fullscreen: false })
      clock += 46 * 60_000
    }
    expect(JSON.parse(readFileSync(statePath, 'utf8')).recent).toEqual(['第1句', '第2句', '第3句'])
    // 重启：新实例读同一 statePath；回拨到距上次仅 1 分钟 → 频控仍生效
    const hb2 = makeHeartbeat()
    clock -= 45 * 60_000
    await hb2.onIdle({ idleMinutes: 60, fullscreen: false })
    expect(spoken).toHaveLength(4)   // 频控拦住，没有第 5 条
  })
})

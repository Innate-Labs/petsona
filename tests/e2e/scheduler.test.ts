// M3 调度链路端到端：预置 scheduled.json 的到期任务 → 启动即 tick → 消费器 5s 内直出气泡；
// REMINDER_SET/STOP 即时反馈（focus_start / abort 条目不等间隔）
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessProc } from '../helpers/harness.js'

let proc: HarnessProc
let dataDir: string
const UID = 'anon-schede2e'

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'petsona-sched-e2e-'))
  writeFileSync(join(dataDir, 'device.json'), JSON.stringify({ deviceId: 'schede2e' }))
  mkdirSync(join(dataDir, UID), { recursive: true })
  // 勿扰关掉（起止相等=未启用）、心跳关掉，测试只看 cron→队列→消费链路
  writeFileSync(join(dataDir, UID, 'config.json'), JSON.stringify({
    gatewayUrl: 'http://127.0.0.1:9',   // 不可达也无妨：本链路不出网
    reminders: { pomodoro: { focusMin: 25, restMin: 5 }, waterMin: 60, standMin: 45 },
    proactive: { frequency: 'off', quietHours: ['00:00', '00:00'], fullscreenMute: false },
    taskBudget: { maxToolCalls: 40, maxTokens: 50000, wallclockMin: 10, approvalWaitMin: 10 },
    scopes: [],
  }))
  // 61 分钟前触发过的 water：启动 tick 立刻到期
  writeFileSync(join(dataDir, UID, 'scheduled.json'), JSON.stringify([
    { id: 'water', cron: '', kind: 'water', durable: true, lastFiredAt: Date.now() - 61 * 60_000 },
  ]))
  proc = new HarnessProc({ PETSONA_DATA_DIR: dataDir })
})

afterAll(() => proc.kill())

describe('M3 调度器 e2e', () => {
  it('预置到期 water 任务 → REMINDER_FIRED + PET_BUBBLE(kind reminder)', async () => {
    const fired = await proc.waitFor((e) => e.type === 'REMINDER_FIRED' && e.payload?.kind === 'water', 15_000)
    expect(typeof fired.payload.petLine).toBe('string')
    expect(fired.payload.petLine.length).toBeGreaterThan(0)
    const bubble = await proc.waitFor((e) => e.type === 'PET_BUBBLE' && e.payload?.kind === 'reminder', 15_000)
    expect(bubble.payload.text).toBe(fired.payload.petLine)
  })
  it('water lastFiredAt 已更新落盘（durable 重启存活）', async () => {
    await proc.waitFor((e) => e.type === 'REMINDER_FIRED', 15_000)
    const onDisk = JSON.parse(readFileSync(join(dataDir, UID, 'scheduled.json'), 'utf8'))
    const water = onDisk.find((j: any) => j.kind === 'water')
    expect(Date.now() - water.lastFiredAt).toBeLessThan(60_000)
    expect(onDisk.find((j: any) => j.kind === 'dream')).toBeDefined()   // 默认 dream 任务已建
  })
  it('REMINDER_SET pomodoro → 即时 focus_start；REMINDER_STOP → abort；不落盘', async () => {
    const res = await proc.request('REMINDER_SET', { kind: 'pomodoro', config: { focusMin: 25, restMin: 5 } })
    expect(res.ok).toBe(true)
    await proc.waitFor((e) => e.type === 'REMINDER_FIRED' && e.payload?.phase === 'focus_start', 15_000)
    await proc.request('REMINDER_STOP', { kind: 'pomodoro' })
    await proc.waitFor((e) => e.type === 'REMINDER_FIRED' && e.payload?.phase === 'abort', 15_000)
    const onDisk = JSON.parse(readFileSync(join(dataDir, UID, 'scheduled.json'), 'utf8'))
    expect(onDisk.find((j: any) => j.kind === 'pomodoro')).toBeUndefined()
  })
  it('REMINDER_SET 非法 kind → BAD_REQUEST', async () => {
    await expect(proc.request('REMINDER_SET', { kind: 'nap' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

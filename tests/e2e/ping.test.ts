// PING 端到端（v3.0 A.3 交付即跑项）：真实 spawn + stdio NDJSON 往返

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessProc } from '../helpers/harness.js'

let h: HarnessProc

beforeAll(() => {
  h = new HarnessProc({ PETSONA_DATA_DIR: mkdtempSync(join(tmpdir(), 'petsona-ping-')) })
})

afterAll(() => h.kill())

describe('PING e2e', () => {
  it('req PING → res { ok:true, uptimeSec }', async () => {
    const res = await h.request('PING', {})
    expect(res.ok).toBe(true)
    expect(typeof res.uptimeSec).toBe('number')
  })

  it('未知 type warn+drop（不崩、不响应）', async () => {
    h.send('NOT_A_REAL_TYPE', {})
    // 再发 PING 验证进程仍活
    const res = await h.request('PING', {})
    expect(res.ok).toBe(true)
  })

  it('PLAN_GET 未知计划返回 BAD_REQUEST', async () => {
    await expect(h.request('PLAN_GET', { planId: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

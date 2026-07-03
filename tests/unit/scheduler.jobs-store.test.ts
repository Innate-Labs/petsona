import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CronJob } from '@petsona/shared'
import { loadJobs, saveJobs } from '../../packages/harness/src/scheduler/jobs_store.js'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'petsona-jobs-')), 'scheduled.json')

describe('jobs_store', () => {
  it('文件不存在 → []', () => {
    expect(loadJobs(tmp())).toEqual([])
  })
  it('损坏 JSON → []（不抛）', () => {
    const p = tmp()
    writeFileSync(p, '{oops')
    expect(loadJobs(p)).toEqual([])
  })
  it('roundtrip 只持久化 durable 任务', () => {
    const p = tmp()
    const jobs: CronJob[] = [
      { id: 'dream', cron: '30 3 * * *', kind: 'dream', durable: true, lastFiredAt: 123 },
      { id: 'pomodoro', cron: '', kind: 'pomodoro', durable: false, payload: { phase: 'focus' } },
      { id: 'water', cron: '', kind: 'water', durable: true, lastFiredAt: 456 },
    ]
    saveJobs(p, jobs)
    const loaded = loadJobs(p)
    expect(loaded.map((j) => j.id).sort()).toEqual(['dream', 'water'])
    expect(loaded.find((j) => j.id === 'dream')!.lastFiredAt).toBe(123)
  })
  it('非数组内容 → []', () => {
    const p = tmp()
    writeFileSync(p, '{"not":"array"}')
    expect(loadJobs(p)).toEqual([])
  })
  it('写入是完整 JSON（原子写不留 tmp）', () => {
    const p = tmp()
    saveJobs(p, [{ id: 'x', cron: '0 0 * * *', kind: 'anniversary', durable: true }])
    expect(JSON.parse(readFileSync(p, 'utf8'))).toHaveLength(1)
  })
})

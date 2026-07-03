// scheduled.json 读写（§3.8 durable 模式：重启存活）。
// 为什么原子写：tick 每 30s 可能落盘，进程被杀时避免半个 JSON 毁掉全部任务。

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { CronJob } from '@petsona/shared'

export function loadJobs(path: string): CronJob[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((j): j is CronJob => typeof j?.id === 'string' && typeof j?.kind === 'string')
  } catch {
    return []   // 损坏当空处理，durable 任务由默认任务兜底重建（dream 在 CronScheduler.start 恢复）
  }
}

export function saveJobs(path: string, jobs: CronJob[]): void {
  const durable = jobs.filter((j) => j.durable)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(durable, null, 2))
  renameSync(tmp, path)
}

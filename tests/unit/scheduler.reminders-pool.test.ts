// 缝②：提醒文案只进文案池，不散落代码（P-POMODORO/HEALTH-NUDGE 的文案池直出档，架构 §4.2）
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FallbackPool } from '../../packages/harness/src/persona/fallback_pool.js'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../packages/assets/fallback')
const KEYS = [
  'reminder_pomodoro_focus_start', 'reminder_pomodoro_focus_end',
  'reminder_pomodoro_rest_end', 'reminder_pomodoro_abort',
  'reminder_water', 'reminder_stand',
]

describe('提醒文案池', () => {
  it('六个 key 全部存在且每个 ≥3 变体、≤25 字', () => {
    const data = JSON.parse(readFileSync(join(ASSETS, 'reminders.json'), 'utf8')) as Record<string, string[]>
    for (const key of KEYS) {
      expect(data[key], key).toBeDefined()
      expect(data[key]!.length, key).toBeGreaterThanOrEqual(3)
      for (const line of data[key]!) expect(line.length, `${key}: ${line}`).toBeLessThanOrEqual(25)
    }
  })
  it('FallbackPool 能装载并轮换', () => {
    const pool = new FallbackPool()
    pool.load(ASSETS)
    const a = pool.pick('reminder_water')
    const b = pool.pick('reminder_water')
    expect(a).not.toBe(b)   // 变体轮换，连续触发不重复
  })
})

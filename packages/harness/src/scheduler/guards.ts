// p02 频控与勿扰（§3.8 / 架构 p02）：纯函数，心跳与提醒消费共用同一套硬校验

import type { ProactiveFrequency } from '@petsona/shared'
import { PROACTIVE_MIN_GAP } from '@petsona/shared'

/** "HH:MM" → 当日分钟数；解析失败返回 null */
function toMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const v = parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10)
  return v < 24 * 60 ? v : null
}

export function inQuietHours(now: Date, window: [string, string]): boolean {
  const start = toMinutes(window[0])
  const end = toMinutes(window[1])
  if (start === null || end === null || start === end) return false   // 起止相等视为未启用
  const cur = now.getHours() * 60 + now.getMinutes()
  return start < end ? cur >= start && cur < end : cur >= start || cur < end   // 跨零点
}

export type P02Verdict = 'ok' | 'off' | 'gap' | 'quiet' | 'fullscreen'

export function p02Gate(input: {
  frequency: ProactiveFrequency
  quietHours: [string, string]
  fullscreenMute: boolean
  fullscreen: boolean
  lastProactiveAt: number
  now: number
}): P02Verdict {
  if (input.frequency === 'off') return 'off'
  if (input.fullscreenMute && input.fullscreen) return 'fullscreen'
  if (inQuietHours(new Date(input.now), input.quietHours)) return 'quiet'
  if (input.now - input.lastProactiveAt < PROACTIVE_MIN_GAP[input.frequency] * 60_000) return 'gap'
  return 'ok'
}

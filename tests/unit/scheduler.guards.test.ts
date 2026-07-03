// p02 硬校验（§3.8 / 架构 §4.1）：模型可以想说话，Harness 决定能不能说
import { describe, expect, it } from 'vitest'
import { inQuietHours, p02Gate } from '../../packages/harness/src/scheduler/guards.js'

const at = (s: string) => new Date(`2026-07-03T${s}:00`)

describe('inQuietHours', () => {
  it('跨零点窗口 22:00-09:00', () => {
    expect(inQuietHours(at('23:30'), ['22:00', '09:00'])).toBe(true)
    expect(inQuietHours(at('03:00'), ['22:00', '09:00'])).toBe(true)
    expect(inQuietHours(at('08:59'), ['22:00', '09:00'])).toBe(true)
    expect(inQuietHours(at('09:00'), ['22:00', '09:00'])).toBe(false)
    expect(inQuietHours(at('12:00'), ['22:00', '09:00'])).toBe(false)
  })
  it('同日窗口 12:00-14:00', () => {
    expect(inQuietHours(at('13:00'), ['12:00', '14:00'])).toBe(true)
    expect(inQuietHours(at('14:00'), ['12:00', '14:00'])).toBe(false)
  })
  it('起止相等 = 未启用', () => {
    expect(inQuietHours(at('00:00'), ['00:00', '00:00'])).toBe(false)
  })
})

describe('p02Gate', () => {
  const base = {
    frequency: 'mid' as const,
    quietHours: ['22:00', '09:00'] as [string, string],
    fullscreenMute: true,
    fullscreen: false,
    lastProactiveAt: 0,
    now: at('12:00').getTime(),
  }
  it('频次 off → off', () => {
    expect(p02Gate({ ...base, frequency: 'off' })).toBe('off')
  })
  it('全屏且 fullscreenMute → fullscreen', () => {
    expect(p02Gate({ ...base, fullscreen: true })).toBe('fullscreen')
    expect(p02Gate({ ...base, fullscreen: true, fullscreenMute: false })).toBe('ok')
  })
  it('勿扰时段 → quiet', () => {
    expect(p02Gate({ ...base, now: at('23:00').getTime() })).toBe('quiet')
  })
  it('mid 档 45 分钟频控', () => {
    const now = at('12:00').getTime()
    expect(p02Gate({ ...base, now, lastProactiveAt: now - 44 * 60_000 })).toBe('gap')
    expect(p02Gate({ ...base, now, lastProactiveAt: now - 45 * 60_000 })).toBe('ok')
  })
  it('全通过 → ok', () => {
    expect(p02Gate(base)).toBe('ok')
  })
})

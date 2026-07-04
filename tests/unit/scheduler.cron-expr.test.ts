// §3.8 五段 cron：分 时 日 月 周；支持 * , - */n；日与周同时受限时按标准 cron 取 OR
import { describe, expect, it } from 'vitest'
import { cronMatches, isValidCron } from '../../packages/harness/src/scheduler/cron_expr.js'

const d = (s: string) => new Date(s)

describe('cronMatches', () => {
  it('DREAM_CRON 每日 03:30 只在 03:30 命中', () => {
    expect(cronMatches('30 3 * * *', d('2026-07-03T03:30:10'))).toBe(true)
    expect(cronMatches('30 3 * * *', d('2026-07-03T03:31:00'))).toBe(false)
    expect(cronMatches('30 3 * * *', d('2026-07-03T04:30:00'))).toBe(false)
  })
  it('每日 00:00（纪念日/陪伴天数）', () => {
    expect(cronMatches('0 0 * * *', d('2026-07-03T00:00:30'))).toBe(true)
    expect(cronMatches('0 0 * * *', d('2026-07-03T12:00:00'))).toBe(false)
  })
  it('步进 */15 与列表/区间', () => {
    expect(cronMatches('*/15 * * * *', d('2026-07-03T10:45:00'))).toBe(true)
    expect(cronMatches('*/15 * * * *', d('2026-07-03T10:44:00'))).toBe(false)
    expect(cronMatches('0 9,18 * * *', d('2026-07-03T18:00:00'))).toBe(true)
    expect(cronMatches('0 9-11 * * *', d('2026-07-03T10:00:00'))).toBe(true)
    expect(cronMatches('0 9-11 * * *', d('2026-07-03T12:00:00'))).toBe(false)
  })
  it('周日 0 与 7 等价', () => {
    // 2026-07-05 是周日
    expect(cronMatches('0 8 * * 0', d('2026-07-05T08:00:00'))).toBe(true)
    expect(cronMatches('0 8 * * 7', d('2026-07-05T08:00:00'))).toBe(true)
    expect(cronMatches('0 8 * * 1', d('2026-07-05T08:00:00'))).toBe(false)
  })
  it('日与周都受限时取 OR（标准 cron 语义）', () => {
    // 2026-07-03 是周五、3 号
    expect(cronMatches('0 8 3 * 1', d('2026-07-03T08:00:00'))).toBe(true)   // 日命中
    expect(cronMatches('0 8 15 * 5', d('2026-07-03T08:00:00'))).toBe(true)  // 周命中
    expect(cronMatches('0 8 15 * 1', d('2026-07-03T08:00:00'))).toBe(false) // 都不中
  })
  it('非法表达式返回 false 不抛', () => {
    expect(cronMatches('bad', d('2026-07-03T08:00:00'))).toBe(false)
    expect(cronMatches('61 * * * *', d('2026-07-03T08:00:00'))).toBe(false)
    expect(cronMatches('', d('2026-07-03T08:00:00'))).toBe(false)
  })
})

describe('isValidCron', () => {
  it('校验字段数与取值域', () => {
    expect(isValidCron('30 3 * * *')).toBe(true)
    expect(isValidCron('*/5 0-23 1,15 * 0-6')).toBe(true)
    expect(isValidCron('30 3 * *')).toBe(false)
    expect(isValidCron('60 * * * *')).toBe(false)
    expect(isValidCron('* * 0 * *')).toBe(false)   // 日从 1 起
  })
})

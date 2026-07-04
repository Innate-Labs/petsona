// p04 情绪状态机契约（§4：驻留 ≥90s、每轮 ≤1 切换、六态）

import { describe, expect, it } from 'vitest'
import { EmotionMachine } from '../../apps/shell/ui/pet/EmotionMachine.js'

function makeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('EmotionMachine（p04）', () => {
  it('首个信号立即生效（启动 calm 不吃驻留）', () => {
    const clock = makeClock()
    const m = new EmotionMachine({ dwellMs: 90_000, now: clock.now })
    m.signal('happy', '用户夸了我')
    expect(m.getState()).toBe('happy')
    m.dispose()
  })

  it('驻留 90s 内不切换，期满取最新排队信号', () => {
    const clock = makeClock()
    const m = new EmotionMachine({ dwellMs: 90_000, now: clock.now })
    m.signal('happy', 'a')
    m.markTurn()
    m.signal('sad', 'b')          // 驻留期内：只排队
    expect(m.getState()).toBe('happy')
    m.signal('angry', 'c')        // 覆盖排队 → 期满应取 angry
    clock.advance(90_001)
    m.markTurn()                  // 触发 tryApply 复核（定时器路径在假时钟下不可靠，走额度路径）
    expect(m.getState()).toBe('angry')
    m.dispose()
  })

  it('每轮对话 ≤1 次切换：额度用尽后信号排队，markTurn 恢复', () => {
    const clock = makeClock()
    const m = new EmotionMachine({ dwellMs: 0, now: clock.now })   // 关掉驻留，单测额度维度
    m.signal('happy', 'a')
    expect(m.getState()).toBe('happy')     // 本轮唯一额度已消费
    m.signal('sad', 'b')
    expect(m.getState()).toBe('happy')     // 额度用尽 → 不切
    m.markTurn()
    expect(m.getState()).toBe('sad')       // 新一轮：排队信号生效
    m.dispose()
  })

  it('同态信号清空排队（最新意图=维持现状）', () => {
    const clock = makeClock()
    const m = new EmotionMachine({ dwellMs: 0, now: clock.now })
    m.signal('happy', 'a')
    m.signal('sad', 'b')          // 排队（额度用尽）
    m.signal('happy', 'c')        // 同当前态 → 清空排队
    m.markTurn()
    expect(m.getState()).toBe('happy')
    m.dispose()
  })

  it('订阅者在切换时收到通知，退订后不再收', () => {
    const clock = makeClock()
    const m = new EmotionMachine({ dwellMs: 0, now: clock.now })
    const seen: string[] = []
    const off = m.subscribe((s) => seen.push(s))
    m.signal('anxious', 'ddl')
    expect(seen).toEqual(['anxious'])
    off()
    m.markTurn()
    m.signal('calm', 'done')
    expect(seen).toEqual(['anxious'])
    m.dispose()
  })
})

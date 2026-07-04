import { describe, expect, it } from 'vitest'
import { InjectionQueue } from '../../packages/harness/src/loop/injection_queue.js'

const reminder = (kind: string) => ({
  source: 'cron' as const, priority: 2 as const,
  content: `<reminder kind="${kind}"/>`, dedupeKey: `reminder:${kind}`,
})

describe('InjectionQueue M3 扩展', () => {
  it('drain 带 eligible 过滤：提醒条目留在队里', () => {
    const q = new InjectionQueue()
    q.push(reminder('water'))
    q.push({ source: 'task', priority: 1, content: '<task-result/>' })
    const items = q.drain(Date.now(), (i) => !i.content.startsWith('<reminder '))
    expect(items.map((i) => i.source)).toEqual(['task'])
    expect(q.size).toBe(1)   // 提醒还在
  })
  it('drainWhere 只取命中谓词的条目', () => {
    const q = new InjectionQueue()
    q.push(reminder('water'))
    q.push(reminder('stand'))
    q.push({ source: 'system', priority: 3, content: '<sys/>' })
    const items = q.drainWhere((i) => i.content.startsWith('<reminder '))
    expect(items).toHaveLength(2)
    expect(q.size).toBe(1)
  })
  it('drainWhere 丢弃过期条目', () => {
    const q = new InjectionQueue()
    q.push({ ...reminder('water'), expiresAt: 1000 })
    expect(q.drainWhere(() => true, 2000)).toEqual([])
  })
  it('drain 不带过滤时行为不变（priority 排序、最多 3 条）', () => {
    const q = new InjectionQueue()
    for (const p of [3, 1, 2, 3] as const) q.push({ source: 'system', priority: p, content: `p${p}-${Math.random()}` })
    const items = q.drain()
    expect(items.map((i) => i.priority)).toEqual([1, 2, 3])
    expect(q.size).toBe(1)
  })
})

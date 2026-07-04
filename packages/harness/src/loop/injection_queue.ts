// 注入队列（§3.8）：调度器/任务/心跳产物 → 陪伴循环下一轮 LLM 调用前 drain
// 过期项丢弃、dedupeKey 去重、按 priority 排序，单轮最多 3 条

import type { InjectionItem } from '@petsona/shared'
import { INJECTION_MAX_PER_TURN } from '@petsona/shared'

export class InjectionQueue {
  private items: InjectionItem[] = []

  push(item: InjectionItem): void {
    if (item.dedupeKey && this.items.some((i) => i.dedupeKey === item.dedupeKey)) return
    this.items.push(item)
  }

  drain(now = Date.now(), eligible: (i: InjectionItem) => boolean = () => true): InjectionItem[] {
    this.items = this.items.filter((i) => !i.expiresAt || i.expiresAt > now)
    const sorted = this.items.filter(eligible).sort((a, b) => a.priority - b.priority)
    const taken = sorted.slice(0, INJECTION_MAX_PER_TURN)
    this.items = this.items.filter((i) => !taken.includes(i))
    return taken
  }

  /** 谓词命中全取（不限 3 条）——提醒消费器用；过期项同样先丢弃 */
  drainWhere(pred: (i: InjectionItem) => boolean, now = Date.now()): InjectionItem[] {
    this.items = this.items.filter((i) => !i.expiresAt || i.expiresAt > now)
    const taken = this.items.filter(pred)
    this.items = this.items.filter((i) => !taken.includes(i))
    return taken
  }

  get size(): number {
    return this.items.length
  }
}

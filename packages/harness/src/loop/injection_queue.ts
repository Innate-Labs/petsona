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

  drain(now = Date.now()): InjectionItem[] {
    this.items = this.items.filter((i) => !i.expiresAt || i.expiresAt > now)
    const sorted = [...this.items].sort((a, b) => a.priority - b.priority)
    const taken = sorted.slice(0, INJECTION_MAX_PER_TURN)
    this.items = this.items.filter((i) => !taken.includes(i))
    return taken
  }

  get size(): number {
    return this.items.length
  }
}

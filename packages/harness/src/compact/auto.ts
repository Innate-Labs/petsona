// L4 auto：强制截断到预算内 + 本轮降档 cheap（架构文档 §2.1 s08 第四层）

import type { CompactContext } from './index.js'
import { estimateChars } from './index.js'

export function applyAuto(ctx: CompactContext, threshold: number): CompactContext {
  let current: CompactContext = { ...ctx, tierDowngraded: true, applied: [...ctx.applied, 'auto'] }
  // 从最老消息开始丢，至少保留最后一条 user 输入
  while (estimateChars(current) >= threshold && current.messages.length > 1) {
    current = { ...current, messages: current.messages.slice(1) }
  }
  // 仍超预算 → 截断唯一剩余消息正文
  if (estimateChars(current) >= threshold && current.messages.length === 1) {
    const only = current.messages[0]!
    const text = typeof only.content === 'string' ? only.content : JSON.stringify(only.content)
    current = { ...current, messages: [{ role: only.role, content: text.slice(0, Math.floor(threshold / 2)) }] }
  }
  return current
}

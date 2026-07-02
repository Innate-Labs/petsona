// L1 budget：清理旧的会话轮次，保留最近 3 轮（user+assistant 对）

import type { CompactContext } from './index.js'

const KEEP_TURNS = 3

export function applyBudget(ctx: CompactContext): CompactContext {
  // 保留最近 KEEP_TURNS 组 user/assistant；更早的丢弃（已被 extract 记住）
  const keep = KEEP_TURNS * 2
  if (ctx.messages.length <= keep) return { ...ctx, applied: [...ctx.applied, 'budget:noop'] }
  return {
    ...ctx,
    messages: ctx.messages.slice(-keep),
    applied: [...ctx.applied, 'budget'],
  }
}

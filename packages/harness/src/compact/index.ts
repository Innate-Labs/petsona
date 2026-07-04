// s08 压缩四层：budget→snip→micro→auto（阈值 50K 估算字符，v3.0 §3.9）
// 在 PreLLM hook 内、assemble 之前执行；压缩前必先 extract（调用方保证——「先记住，再遗忘」）

import type { LlmMessage } from '@petsona/shared'
import { applyBudget } from './budget.js'
import { applySnip } from './snip.js'
import { applyMicro } from './micro.js'
import { applyAuto } from './auto.js'

export const COMPACT_THRESHOLD_CHARS = 50_000

export type CompactContext = {
  messages: LlmMessage[]       // 会话消息（hot 在场部分）
  warmBlock: string            // 记忆 warm 段渲染文本
  coldBlock: string            // 记忆 cold 段渲染文本
  tierDowngraded: boolean      // auto 层触发时降 cheap 档
  applied: string[]            // 命中的层（hookTrace 用）
}

export function estimateChars(ctx: CompactContext): number {
  const msgChars = ctx.messages.reduce(
    (n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length),
    0,
  )
  return msgChars + ctx.warmBlock.length + ctx.coldBlock.length
}

/** 逐层触发：>80% budget、>90% snip、>95% micro、≥100% auto（架构文档 §2.1） */
export function runCompact(ctx: CompactContext, threshold = COMPACT_THRESHOLD_CHARS): CompactContext {
  let current = ctx
  const ratio = () => estimateChars(current) / threshold
  if (ratio() > 0.8) current = applyBudget(current)
  if (ratio() > 0.9) current = applySnip(current)
  if (ratio() > 0.95) current = applyMicro(current)
  if (ratio() >= 1.0) current = applyAuto(current, threshold)
  return current
}

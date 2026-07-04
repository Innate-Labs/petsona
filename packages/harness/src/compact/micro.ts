// L3 micro：cold 层记忆只保留条目名（首个 [] 标签），不含正文

import type { CompactContext } from './index.js'

export function applyMicro(ctx: CompactContext): CompactContext {
  const micro = ctx.coldBlock
    .split('\n')
    .map((line) => {
      const m = line.match(/^\[([^\]]+)\]/)
      return m ? `[${m[1]}]` : line.slice(0, 20)
    })
    .join('\n')
  return { ...ctx, coldBlock: micro, applied: [...ctx.applied, 'micro'] }
}

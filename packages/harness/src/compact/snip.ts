// L2 snip：对 warm 段摘要做缩略（每行截前 40 字）

import type { CompactContext } from './index.js'

export function applySnip(ctx: CompactContext): CompactContext {
  const snipped = ctx.warmBlock
    .split('\n')
    .map((line) => (line.length > 40 ? line.slice(0, 40) + '…' : line))
    .join('\n')
  return { ...ctx, warmBlock: snipped, applied: [...ctx.applied, 'snip'] }
}

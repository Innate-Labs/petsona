// 缝②：人格唯一出口（p03）——所有面向用户文本必经此处或兜底文案池
// 结构性纪律：CHAT_*/PET_BUBBLE 的用户可见文本只能来自 wrapReply / FallbackPool

import type { GatewayClient } from '../gateway/client.js'

export type WrappedReply = { reply: string; bubble: string }

/** P-BUBBLE-COMPRESS：完整回复 → ≤18 字气泡摘要（cheap 档；失败降级为截断） */
export async function compressBubble(gateway: GatewayClient, reply: string): Promise<string> {
  if (reply.length <= 18) return reply
  try {
    const res = await gateway.chatOnce({
      tier: 'cheap',
      system: '把这句话压成 ≤18 个字的宠物气泡短句，保留口吻。只输出短句。',
      messages: [{ role: 'user', content: reply.slice(0, 500) }],
      stream: false,
      maxTokens: 60,
      meta: { loop: 'companion' },
    })
    const block = res.content.find((b) => b.type === 'text')
    const bubble = block && block.type === 'text' ? block.text.trim() : ''
    if (bubble && bubble.length <= 24) return bubble.slice(0, 18)
  } catch { /* 降级 */ }
  return reply.slice(0, 17) + '…'
}

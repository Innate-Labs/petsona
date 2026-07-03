// p01 决策调用（P-PROACTIVE-IDLE，提示词体系 §5.2）+ p02 语义去重（cheap 档，失败视为重复）。
// 为什么放 persona/：这是人格出口的一部分（缝②）；心跳只拿函数注入，scheduler/ 不碰 gateway。

import type { LlmChatResponse, ProactiveFrequency } from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'
import { timeScene } from './assemble.js'

const FREQ_LABEL: Record<Exclude<ProactiveFrequency, 'off'>, string> = { high: '多', mid: '中', low: '少' }

export type ProactiveInput = {
  idleMinutes: number
  frequency: Exclude<ProactiveFrequency, 'off'>
  personaCore: string
  lastTopic?: string
}

function textOf(res: LlmChatResponse): string {
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

function parseJson(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export async function decideProactive(
  gw: Pick<GatewayClient, 'chatOnce'>, input: ProactiveInput,
): Promise<string | null> {
  const system = `${input.personaCore}\n\n你现在是主动陪伴决策器。只输出 JSON，不输出其他内容。`
  const user = [
    `用户已经 ${input.idleMinutes} 分钟没和你说话了。${timeScene()}。主动频次设置：${FREQ_LABEL[input.frequency]}。`,
    input.lastTopic ? `最近一次对话的话题：${input.lastTopic}` : '',
    '你决定要不要主动冒一句话（≤25 字）。约束：不能问问题、不催回应（❌「你还在吗」「怎么不理我」）；可以陈述、可以撒娇。',
    '输出 JSON：{"should_speak": true|false, "bubble_text": "气泡里的话"}；不想说就 {"should_speak": false}。',
  ].filter(Boolean).join('\n')
  try {
    const res = await gw.chatOnce({
      tier: 'cheap', system, messages: [{ role: 'user', content: user }],
      stream: false, maxTokens: 200, meta: { loop: 'proactive' },
    })
    const parsed = parseJson(textOf(res))
    if (!parsed || parsed.should_speak !== true) return null
    const text = typeof parsed.bubble_text === 'string' ? parsed.bubble_text.trim() : ''
    return text ? text.slice(0, 50) : null
  } catch {
    return null   // 决策失败 = 这次不说话，静默放弃（主动性是加分项，不值得走兜底气泡）
  }
}

export async function isSimilarToRecent(
  gw: Pick<GatewayClient, 'chatOnce'>, text: string, recent: string[],
): Promise<boolean> {
  if (recent.length === 0) return false
  const user = [
    `候选句："${text}"`,
    `历史句子：\n${recent.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    '候选句与任一历史句语义相近（同一意思换说法）吗？只输出 JSON：{"similar": true|false}',
  ].join('\n')
  try {
    const res = await gw.chatOnce({
      tier: 'cheap', system: '你是语义相似判定器。只输出 JSON。',
      messages: [{ role: 'user', content: user }],
      stream: false, maxTokens: 50, meta: { loop: 'proactive' },
    })
    const parsed = parseJson(textOf(res))
    if (!parsed || typeof parsed.similar !== 'boolean') return true
    return parsed.similar
  } catch {
    return true   // p02 纪律：判定失败视为重复（宁可不说，不重复唠叨）
  }
}

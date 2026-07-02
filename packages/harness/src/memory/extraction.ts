// extraction 管线（s09）：每轮结束后跑（压缩前快照）；cheap 档判定；与 MEMORY.md 去重

import type { ColdItem, ColdType, LlmMessage } from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'
import { ColdFs, coldName } from './coldfs.js'

const EXTRACT_SYSTEM = `你是记忆提取器。从对话片段中提取值得长期记住的用户信息。
只输出 JSON 数组，每项：{"type":"preference|fact|emotion|profile|meme","topic":"点分话题如 pref.tone","fact":"一句话事实"}
没有值得记的就输出 []。不编造、不提取一次性上下文。`

export async function extractColdItems(
  gateway: GatewayClient,
  cold: ColdFs,
  snapshot: LlmMessage[],
): Promise<ColdItem[]> {
  if (snapshot.length === 0) return []
  const convo = snapshot
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n')
    .slice(0, 8000)

  let rawItems: { type: ColdType; topic: string; fact: string }[]
  try {
    const res = await gateway.chatOnce({
      tier: 'cheap',
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: convo }],
      stream: false,
      maxTokens: 1000,
      meta: { loop: 'memory' },
    })
    const text = res.content.find((b) => b.type === 'text')
    rawItems = text && text.type === 'text' ? JSON.parse(extractJson(text.text)) : []
  } catch {
    return []   // cheap 档失败不阻塞对话（s09 纪律：提取尽力而为）
  }
  if (!Array.isArray(rawItems)) return []

  // 与 MEMORY.md（现存 cold 全量）去重：同 topic 且事实近似 → 更新 lastT 而非新建
  const existing = cold.list()
  const written: ColdItem[] = []
  for (const raw of rawItems.slice(0, 5)) {
    if (!raw?.fact || !raw?.topic) continue
    const dupe = existing.find((c) => c.topic === raw.topic && similar(c.body, raw.fact))
    const item: ColdItem = dupe
      ? { ...dupe, lastT: new Date().toISOString() }
      : {
          name: uniqueName(cold, coldName(raw.type ?? 'fact', raw.fact)),
          type: (raw.type ?? 'fact') as ColdType,
          topic: raw.topic,
          source: 'chat',
          lastT: new Date().toISOString(),
          body: raw.fact,
        }
    cold.write(item)
    if (!dupe) written.push(item)
  }
  return written
}

function extractJson(text: string): string {
  const m = text.match(/\[[\s\S]*\]/)
  return m ? m[0] : '[]'
}

function similar(a: string, b: string): boolean {
  const na = a.replace(/\s/g, '')
  const nb = b.replace(/\s/g, '')
  return na === nb || na.includes(nb) || nb.includes(na)
}

function uniqueName(cold: ColdFs, base: string): string {
  if (!cold.read(base)) return base
  let i = 2
  while (cold.read(`${base}-${i}`)) i++
  return `${base}-${i}`
}

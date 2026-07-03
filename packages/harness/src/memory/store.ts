// §3.9 MemoryStore（s09 × v2.1 融合）——缝③：业务代码只依赖本接口

import type {
  ColdItem, ColdSource, ColdType, DreamReport, LlmMessage, PromptMemory, Turn, WarmItem,
} from '@petsona/shared'
import {
  HOT_COMPACT_THRESHOLD, HOT_COMPACT_BATCH, WARM_MERGE_THRESHOLD, WARM_MERGE_BATCH,
} from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'
import { SessionsDb } from './sqlite.js'
import { ColdFs, coldName } from './coldfs.js'
import { assembleMemory } from './selection.js'
import { extractColdItems } from './extraction.js'
import { runDream } from './dream.js'

export interface MemoryStore {
  assemble(triggers: string[]): PromptMemory
  recall(topic: string): (WarmItem | ColdItem)[]
  remember(fact: string, type: ColdType, source: ColdSource): ColdItem
  tagTurn(turn: Turn): Promise<string[]>
  extract(preCompactSnapshot: LlmMessage[]): Promise<ColdItem[]>
  dream(): Promise<DreamReport>
}

const TAG_SYSTEM = `给对话打话题标签。输出 JSON 字符串数组（1-3 个点分标签，如 ["pref.tone","work.project"]），无法判断输出 []。只输出 JSON。`

export class LocalMemoryStore implements MemoryStore {
  constructor(
    public readonly db: SessionsDb,
    public readonly cold: ColdFs,
    private gateway: GatewayClient,
  ) {}

  assemble(triggers: string[]): PromptMemory {
    return assembleMemory(this.db, this.cold, triggers)
  }

  recall(topic: string): (WarmItem | ColdItem)[] {
    return [...this.db.warmByTopics([topic], 3), ...this.cold.byTopic(topic, 5)]
  }

  remember(fact: string, type: ColdType, source: ColdSource): ColdItem {
    const item: ColdItem = {
      name: this.uniqueName(coldName(type, fact)),
      type,
      topic: type === 'preference' ? 'pref' : type,   // SPEC-GAP: remember 未带 topic 参数，按 type 归桶
      source,
      lastT: new Date().toISOString(),
      body: fact,
    }
    this.cold.write(item)
    return item
  }

  /** 写入后 cheap 档打标（失败 = ['_untagged']，§2.3 DDL 注释） */
  async tagTurn(turn: Turn): Promise<string[]> {
    try {
      const res = await this.gateway.chatOnce({
        tier: 'cheap',
        system: TAG_SYSTEM,
        messages: [{ role: 'user', content: turn.text.slice(0, 500) }],
        stream: false,
        maxTokens: 100,
        meta: { loop: 'memory' },
      })
      const text = res.content.find((b) => b.type === 'text')
      const topics = text && text.type === 'text' ? JSON.parse(jsonArray(text.text)) : []
      const valid = Array.isArray(topics) ? topics.filter((t) => typeof t === 'string').slice(0, 3) : []
      const final = valid.length ? valid : ['_untagged']
      this.db.setTurnTopics(turn.id, final)
      return final
    } catch {
      this.db.setTurnTopics(turn.id, ['_untagged'])
      return ['_untagged']
    }
  }

  async extract(preCompactSnapshot: LlmMessage[]): Promise<ColdItem[]> {
    return extractColdItems(this.gateway, this.cold, preCompactSnapshot)
  }

  /** 夜间 Dream（§3.8）：hot→warm→cold→consolidate→重建索引，逻辑在 dream.ts */
  async dream(): Promise<DreamReport> {
    return runDream({
      db: this.db,
      cold: this.cold,
      summarize: (text) => this.summarize(text),
      writeCold: (body, topic) => {
        this.cold.write({
          name: this.uniqueName(coldName('fact', body)),
          type: 'fact',
          topic,
          source: 'system',
          lastT: new Date().toISOString(),
          body,
        })
      },
    })
  }

  // ---------- 压缩触发（继承 v2.1 升级④，单进程互斥 = JS 单线程天然满足） ----------

  /** hot>10 → 最老 5 轮压 1 条 warm；warm>6 → 最老 5 条同话题合并进 cold。每轮结束后调用。 */
  async compactIfNeeded(): Promise<void> {
    if (this.db.hotCount() > HOT_COMPACT_THRESHOLD) {
      const oldest = this.db.oldestTurns(HOT_COMPACT_BATCH)
      const summary = await this.summarize(oldest.map((t) => `${t.role}: ${t.text}`).join('\n'))
      const topics = [...new Set(oldest.flatMap((t) => t.topics))].filter((t) => t !== '_untagged')
      this.db.insertWarm({
        turnStart: oldest[0]!.id,
        turnEnd: oldest[oldest.length - 1]!.id,
        summary,
        topics: topics.length ? topics : ['_untagged'],
        t: Date.now(),
      })
      this.db.deleteTurns(oldest.map((t) => t.id))
    }
    if (this.db.warmCount() > WARM_MERGE_THRESHOLD) {
      const oldest = this.db.oldestWarm(WARM_MERGE_BATCH)
      const merged = await this.summarize(oldest.map((w) => w.summary).join('\n'))
      const topic = oldest.flatMap((w) => w.topics).find((t) => t !== '_untagged') ?? 'session'
      this.cold.write({
        name: this.uniqueName(coldName('fact', merged)),
        type: 'fact',
        topic,
        source: 'system',
        lastT: new Date().toISOString(),
        body: merged,
      })
      this.db.deleteWarm(oldest.map((w) => w.id))
    }
  }

  private async summarize(text: string): Promise<string> {
    try {
      const res = await this.gateway.chatOnce({
        tier: 'cheap',
        system: '把以下对话压缩成一句 ≤50 字的中文摘要，保留关键事实。只输出摘要。',
        messages: [{ role: 'user', content: text.slice(0, 4000) }],
        stream: false,
        maxTokens: 200,
        meta: { loop: 'memory' },
      })
      const block = res.content.find((b) => b.type === 'text')
      if (block && block.type === 'text' && block.text.trim()) return block.text.trim().slice(0, 100)
    } catch { /* 降级 */ }
    return text.slice(0, 80)   // cheap 档不可用时用截断兜底，压缩不阻塞
  }

  private uniqueName(base: string): string {
    if (!this.cold.read(base)) return base
    let i = 2
    while (this.cold.read(`${base}-${i}`)) i++
    return `${base}-${i}`
  }
}

function jsonArray(text: string): string {
  const m = text.match(/\[[\s\S]*?\]/)
  return m ? m[0] : '[]'
}

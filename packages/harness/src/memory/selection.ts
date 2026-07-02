// v2.1 装配算法原样（§3.9）：RECENT_HOT=3 + TOPIC_HOT≤3 + WARM≤3 + COLD≤5；命中<2 补 warm 保底

import type { PromptMemory } from '@petsona/shared'
import { ASSEMBLE_BUDGET } from '@petsona/shared'
import type { SessionsDb } from './sqlite.js'
import type { ColdFs } from './coldfs.js'

export function assembleMemory(db: SessionsDb, cold: ColdFs, triggers: string[]): PromptMemory {
  const recentHot = db.recentTurns(ASSEMBLE_BUDGET.recentHot)
  const recentIds = recentHot.map((t) => t.id)

  const topicHot = db.turnsByTopics(triggers, ASSEMBLE_BUDGET.topicHot, recentIds)
  let warm = db.warmByTopics(triggers, ASSEMBLE_BUDGET.warm)
  const coldItems = triggers
    .flatMap((tp) => cold.byTopic(tp, ASSEMBLE_BUDGET.cold))
    .filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i)
    .slice(0, ASSEMBLE_BUDGET.cold)

  // 命中 <2 补 warm 保底（用最近 warm 填充）
  const hits = topicHot.length + warm.length + coldItems.length
  if (hits < ASSEMBLE_BUDGET.minHits) {
    const fill = db.recentWarm(ASSEMBLE_BUDGET.warm)
    const seen = new Set(warm.map((w) => w.id))
    warm = [...warm, ...fill.filter((w) => !seen.has(w.id))].slice(0, ASSEMBLE_BUDGET.warm)
  }

  return { recentHot, topicHot, warm, cold: coldItems }
}

/** PromptMemory → prompt 文本块（供 PreLLM 注入） */
export function renderMemory(mem: PromptMemory): string {
  const parts: string[] = []
  if (mem.cold.length) {
    parts.push('<memory-cold>\n' + mem.cold.map((c) => `[${c.type}/${c.topic}] ${c.body}`).join('\n') + '\n</memory-cold>')
  }
  if (mem.warm.length) {
    parts.push('<memory-warm>\n' + mem.warm.map((w) => `- ${w.summary}`).join('\n') + '\n</memory-warm>')
  }
  if (mem.topicHot.length) {
    parts.push('<memory-topic>\n' + mem.topicHot.map((t) => `${t.role}: ${t.text}`).join('\n') + '\n</memory-topic>')
  }
  return parts.join('\n')
}

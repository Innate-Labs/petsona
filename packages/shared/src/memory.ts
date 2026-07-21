// §2.3 / §3.9 记忆类型（s09 × v2.1 融合）

export type TurnRole = 'user' | 'pet'

// hot 层：最近原文轮次（SQLite turns 表）
export type Turn = {
  id: number
  conversationId?: string
  role: TurnRole
  text: string
  t: number                     // epoch ms
  topics: string[]              // 写入后 cheap 档打标（失败= ['_untagged']）
}

export type ChatConversationSummary = {
  id: string
  title: string
  t: number
  updatedAt: number
  messageCount: number
}

// 主动气泡专用会话 id：harness 落轮次、UI 恢复「最近会话」时跳过它（避免默认续在主动消息流上）
export const PROACTIVE_CONVERSATION_ID = '__proactive__'

// warm 层：5 轮压 1 条（SQLite warm_segments 表）
export type WarmItem = {
  id: number
  turnStart: number
  turnEnd: number
  summary: string
  topics: string[]
  t: number
}

// cold 层（memory/cold/<name>.md，frontmatter）
export type ColdType = 'preference' | 'fact' | 'emotion' | 'profile' | 'meme'   // 继承 v2.1 ColdType
export type ColdSource = 'chat' | 'settings' | 'system'   // settings 可编辑，其余 UI 只读

export type ColdItem = {
  name: string                  // kebab-case 唯一
  type: ColdType
  topic: string                 // 话题标签（selection 命中键）
  source: ColdSource
  lastT: string                 // ISO 8601
  body: string
}

export type ColdItemMeta = Omit<ColdItem, 'body'> & { gist: string }   // MEMORY.md 索引行内容

// assemble() 产物（v2.1 装配算法：RECENT_HOT=3 + TOPIC_HOT≤3 + WARM≤3 + COLD≤5；命中<2 补 warm 保底）
export type PromptMemory = {
  recentHot: Turn[]
  topicHot: Turn[]
  warm: WarmItem[]
  cold: ColdItem[]
}

export type DreamReport = {
  ranAt: number
  hotCompacted: number          // hot→warm 压缩条数
  warmMerged: number            // warm→cold 合并条数
  coldMergedDupes: number       // cold consolidate 合并重复数
  coldEvicted: number           // 淘汰 lastT 老且低频数
  indexRebuilt: boolean         // MEMORY.md 重建
  durationMs: number
}

// 压缩触发（继承 v2.1 升级④，锁改单进程互斥）
export const HOT_COMPACT_THRESHOLD = 10       // hot>10 → 最老 5 轮压 1 条 warm
export const HOT_COMPACT_BATCH = 5
export const WARM_MERGE_THRESHOLD = 6         // warm>6 → 最老 5 条同话题合并进 cold
export const WARM_MERGE_BATCH = 5
export const COLD_MAX_ITEMS = 200             // cold 总量 ≤200 条
export const MEMORY_INDEX_MAX_LINES = 200     // MEMORY.md ≤200 行

// 装配预算
export const ASSEMBLE_BUDGET = { recentHot: 3, topicHot: 3, warm: 3, cold: 5, minHits: 2 } as const

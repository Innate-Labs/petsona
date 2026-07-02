// Dream（每日 03:30，s14 调度）——M3 交付；M1 只留类型与入口占位（v3.0 A.3 本轮不做）
// 全量语义见 §3.8：hot→warm 压缩、warm→cold 合并、cold consolidate（≤200 条）→ 重建 MEMORY.md → DreamReport 落日志

import type { DreamReport } from '@petsona/shared'
import type { LocalMemoryStore } from './store.js'

export async function runDream(store: LocalMemoryStore): Promise<DreamReport> {
  return store.dream()
}

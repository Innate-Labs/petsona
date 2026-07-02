// local_rate（PreTurn）——本地频控：网关限流之前先在端上挡住异常高频

import type { PreTurnHook } from '../pipeline.js'
import type { FallbackPool } from '../../persona/fallback_pool.js'

// SPEC-GAP: 规格未给本地频控阈值，取 20 次/分钟
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20

export function makeLocalRate(pool: FallbackPool): PreTurnHook {
  const stamps: number[] = []
  return async () => {
    const now = Date.now()
    while (stamps.length && now - stamps[0]! > WINDOW_MS) stamps.shift()
    if (stamps.length >= MAX_PER_WINDOW) {
      return { reject: 'RATE_LIMIT' as const, petLine: pool.pick('rate_limit') }
    }
    stamps.push(now)
  }
}

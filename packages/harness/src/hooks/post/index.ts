// PostLLM 固定管线：persona_enforce → bubble_compress → fallback → track_end（§3.7）

import type { PostLLMHook } from '../pipeline.js'
import { personaEnforce } from '../../persona/enforce.js'
import { compressBubble } from '../../persona/wrap.js'
import type { FallbackPool } from '../../persona/fallback_pool.js'
import type { GatewayClient } from '../../gateway/client.js'
import type { Tracker } from '../../telemetry/track.js'
import { TRACK } from '@petsona/shared'

export const personaEnforceHook: PostLLMHook = async (draft) => ({
  ...draft,
  text: personaEnforce(draft.text),
})

export function makeBubbleCompressHook(gateway: GatewayClient): PostLLMHook {
  return async (draft) => {
    if (draft.loop !== 'companion' || !draft.text) return draft
    return { ...draft, bubble: await compressBubble(gateway, draft.text) }
  }
}

export function makeFallbackHook(pool: FallbackPool): PostLLMHook {
  return async (draft) => {
    if (draft.text.trim()) return draft
    // 空返回/乱码兜底（继承 v2.1）：文案池直出，不走 LLM
    const line = pool.pick('empty_reply')
    return { ...draft, text: line, bubble: line.slice(0, 18), usedFallback: true }
  }
}

export function makeTrackEndHook(tracker: Tracker): PostLLMHook {
  return async (draft) => {
    tracker.track(TRACK.对话_完成, { loop: draft.loop, usedFallback: !!draft.usedFallback, chars: draft.text.length })
    if (draft.usedFallback) tracker.track(TRACK.兜底_触发, { scene: 'empty_reply' })
    return draft
  }
}

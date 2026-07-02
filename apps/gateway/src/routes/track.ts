// POST /v1/track/batch（§9 埋点批量上报 · M1 骨架：校验 + console 汇总 + 内存计数）
// 约束（v3.0 §9 / v2.1 §9）：不采正文、DeviceID/UserID、域名级脱敏——脱敏在客户端完成，
// 网关只负责收；M1 不落库，计数进内存供自检。
// SPEC-GAP: 埋点匿名可用（v2.1 §9 匿名设备 ID 起步），故本端点不强制 Bearer。

import type { FastifyInstance } from 'fastify'
import type { TrackEvent } from '@petsona/shared'
import { errBody } from '../lib/http.js'

const counters = new Map<number, number>()   // eventId → 累计条数

function isTrackEvent(x: unknown): x is TrackEvent {
  const e = x as Partial<TrackEvent> | null
  return (
    !!e && typeof e === 'object' &&
    typeof e.eventId === 'number' &&
    typeof e.t === 'number' &&
    typeof e.deviceId === 'string' && e.deviceId.length > 0 &&
    typeof e.props === 'object' && e.props !== null
  )
}

export function registerTrackRoutes(app: FastifyInstance): void {
  app.post('/v1/track/batch', async (req, reply) => {
    const body = (req.body ?? {}) as { events?: unknown[] }
    if (!Array.isArray(body.events)) {
      return reply.code(400).send(errBody('BAD_REQUEST', 'events 必须是数组'))
    }
    let accepted = 0
    const byId = new Map<number, number>()
    for (const raw of body.events) {
      if (!isTrackEvent(raw)) continue   // 非法事件丢弃不报错——埋点不能影响主流程
      accepted += 1
      byId.set(raw.eventId, (byId.get(raw.eventId) ?? 0) + 1)
      counters.set(raw.eventId, (counters.get(raw.eventId) ?? 0) + 1)
    }
    if (accepted > 0) {
      const summary = [...byId.entries()].map(([id, n]) => `${id}×${n}`).join(', ')
      console.log(`[gateway][track] 收到 ${accepted} 条埋点：${summary}`)
    }
    return reply.send({ accepted })
  })
}

export function getTrackCounters(): ReadonlyMap<number, number> {
  return counters
}

export function resetTrackCounters(): void {
  counters.clear()
}

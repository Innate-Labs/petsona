// POST /v1/memory/sync（v3.0 §3.2 cold 层云同步 · M1 骨架）
// 仅同步 cold；hot/warm 永不上云。存储为内存 Map（userId → items）。
// SPEC-GAP: 规格未给 mode 字段名——push/pull 请求体形状不同，任务约定 body.mode 显式区分。

import type { FastifyInstance } from 'fastify'
import type { ColdItem } from '@petsona/shared'
import { errBody } from '../lib/http.js'
import { requireUser } from '../auth/jwt.js'

// userId → (name → ColdItem)；name 是 cold 项唯一键（kebab-case，见 shared/memory.ts）
const coldStore = new Map<string, Map<string, ColdItem>>()

function isColdItem(x: unknown): x is ColdItem {
  const c = x as Partial<ColdItem> | null
  return (
    !!c && typeof c === 'object' &&
    typeof c.name === 'string' && typeof c.type === 'string' &&
    typeof c.source === 'string' && typeof c.lastT === 'string' && typeof c.body === 'string'
  )
}

// 冲突策略（v3.0 §3.2 原文）：lastT 新者胜；source=settings 恒优先于 chat。
// 为什么 settings 恒优先：settings 是用户在面板手工编辑的记忆，属显式意图，
// 不允许被聊天自动提取（chat）的旧值或并发值覆盖。
function shouldReplace(incoming: ColdItem, existing: ColdItem | undefined): boolean {
  if (!existing) return true
  if (existing.source === 'settings' && incoming.source !== 'settings') return false
  if (incoming.source === 'settings' && existing.source !== 'settings') return true
  return Date.parse(incoming.lastT) >= Date.parse(existing.lastT)
}

export function registerMemoryRoutes(app: FastifyInstance): void {
  app.post('/v1/memory/sync', async (req, reply) => {
    const auth = requireUser(req)
    if (!auth) return reply.code(401).send(errBody('UNAUTHENTICATED', '请先登录'))

    const body = (req.body ?? {}) as {
      mode?: 'push' | 'pull'
      items?: unknown[]
      deviceId?: string
      since?: number
    }
    const serverTime = Date.now()
    const userItems = coldStore.get(auth.sub) ?? new Map<string, ColdItem>()
    coldStore.set(auth.sub, userItems)

    if (body.mode === 'push') {
      if (!Array.isArray(body.items) || typeof body.deviceId !== 'string' || !body.deviceId) {
        return reply.code(400).send(errBody('BAD_REQUEST', 'push 需要 items 数组与 deviceId'))
      }
      let accepted = 0
      for (const raw of body.items) {
        if (!isColdItem(raw)) continue   // 非法项静默丢弃，不整体失败（同步要尽量前进）
        if (shouldReplace(raw, userItems.get(raw.name))) {
          userItems.set(raw.name, raw)
          accepted += 1
        }
      }
      return reply.send({ accepted, serverTime })
    }

    if (body.mode === 'pull') {
      const since = typeof body.since === 'number' ? body.since : 0
      const items = [...userItems.values()].filter((it) => Date.parse(it.lastT) > since)
      return reply.send({ items, serverTime })
    }

    return reply.code(400).send(errBody('BAD_REQUEST', 'mode 必须是 push|pull'))
  })
}

export function resetMemoryStore(): void {
  coldStore.clear()
}

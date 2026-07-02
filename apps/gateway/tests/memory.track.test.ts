// /v1/memory/sync 与 /v1/track/batch 骨架冒烟（M1：契约形状 + 冲突策略 + 计数）

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { signAccess } from '../src/auth/jwt.js'
import { resetMemoryStore } from '../src/routes/memory.js'

const auth = { authorization: `Bearer ${signAccess('mem-user', 'm@test.dev')}` }

const item = (name: string, source: 'chat' | 'settings', lastT: string) => ({
  name, type: 'preference', topic: 'food', source, lastT, body: `${name} 内容`,
})

describe('/v1/memory/sync 骨架', () => {
  let app: FastifyInstance
  beforeAll(async () => { resetMemoryStore(); app = await buildServer() })
  afterAll(async () => { await app.close() })

  it('401：未登录', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/memory/sync', payload: { mode: 'push' } })
    expect(res.statusCode).toBe(401)
  })

  it('push 校验 items+deviceId → {accepted, serverTime}；pull 按 since 过滤', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/memory/sync', headers: auth, payload: { mode: 'push', items: [] } })
    expect(bad.statusCode).toBe(400)   // 缺 deviceId

    const push = await app.inject({
      method: 'POST', url: '/v1/memory/sync', headers: auth,
      payload: { mode: 'push', deviceId: 'dev-1', items: [item('likes-fish', 'chat', '2026-07-01T00:00:00Z')] },
    })
    expect(push.statusCode).toBe(200)
    expect(push.json().accepted).toBe(1)
    expect(push.json().serverTime).toBeTypeOf('number')

    const pullAll = await app.inject({ method: 'POST', url: '/v1/memory/sync', headers: auth, payload: { mode: 'pull', since: 0 } })
    expect(pullAll.json().items).toHaveLength(1)
    const pullNone = await app.inject({
      method: 'POST', url: '/v1/memory/sync', headers: auth,
      payload: { mode: 'pull', since: Date.parse('2026-07-02T00:00:00Z') },
    })
    expect(pullNone.json().items).toHaveLength(0)
  })

  it('冲突策略：lastT 新者胜；source=settings 恒优先于 chat', async () => {
    const push = (it2: object) => app.inject({
      method: 'POST', url: '/v1/memory/sync', headers: auth,
      payload: { mode: 'push', deviceId: 'dev-1', items: [it2] },
    })
    // 旧 lastT 的 chat 项不覆盖新的
    expect((await push(item('likes-fish', 'chat', '2020-01-01T00:00:00Z'))).json().accepted).toBe(0)
    // settings 覆盖 chat（即便 lastT 更旧）
    expect((await push(item('likes-fish', 'settings', '2020-01-01T00:00:00Z'))).json().accepted).toBe(1)
    // 之后更新的 chat 也不能覆盖 settings
    expect((await push(item('likes-fish', 'chat', '2026-07-02T00:00:00Z'))).json().accepted).toBe(0)
  })
})

describe('/v1/track/batch 骨架', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await buildServer() })
  afterAll(async () => { await app.close() })

  it('校验 events 数组，非法事件丢弃，返回 {accepted}', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/track/batch', payload: {} })
    expect(bad.statusCode).toBe(400)

    const res = await app.inject({
      method: 'POST', url: '/v1/track/batch',
      payload: {
        events: [
          { eventId: 1002, props: { version: '3.0.0' }, t: Date.now(), deviceId: 'anon-1' },
          { eventId: 1101, props: {}, t: Date.now(), deviceId: 'anon-1' },
          { eventId: 9999, props: {} },   // 缺 t/deviceId → 丢弃
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ accepted: 2 })
  })
})

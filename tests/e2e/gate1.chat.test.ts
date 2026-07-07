// M1 Gate ①：冷启动 → 登录 → 面板流式聊天全通（对 mock 网关 hermetic 跑）

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { HarnessProc } from '../helpers/harness.js'
import { startMockGateway } from '../helpers/mock_gateway.js'

let h: HarnessProc
let gw: { url: string; server: Server; calls: string[] }

beforeAll(async () => {
  gw = await startMockGateway({ chatReply: '喵！我在呢。今天也要加油哦！' })
  h = new HarnessProc({
    PETSONA_DATA_DIR: mkdtempSync(join(tmpdir(), 'petsona-gate1-')),
    PETSONA_GATEWAY_URL: gw.url,
  })
  await h.request('PING', {})   // 冷启动就绪
})

afterAll(() => {
  h.kill()
  gw.server.close()
})

describe('Gate ①：登录 → 流式聊天', () => {
  it('登录流程：请求验证码 → 提交 → AUTH_STATE_CHANGED(logged_in)', async () => {
    const code = await h.request('LOGIN_REQUEST_CODE', { email: 'dev@petsona.app' })
    expect(code.ok).toBe(true)
    const login = await h.request('LOGIN_SUBMIT', { email: 'dev@petsona.app', code: '888888' })
    expect(login.ok).toBe(true)
    const evt = await h.waitFor((e) => e.type === 'AUTH_STATE_CHANGED' && e.payload?.loginState === 'logged_in')
    expect(evt.payload.email).toBe('dev@petsona.app')
  })

  it('CHAT_SEND → 流式 CHAT_CHUNK（≥2 帧）→ CHAT_DONE（bubble ≤18 字）', async () => {
    const { turnId } = await h.request('CHAT_SEND', { text: '你好呀' })
    expect(turnId).toMatch(/^turn_/)

    const done = await h.waitFor((e) => e.type === 'CHAT_DONE' && e.payload?.turnId === turnId, 15_000)
    const chunks = h.received.filter((e) => e.type === 'CHAT_CHUNK' && e.payload?.turnId === turnId)
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    // 流式拼接 === 最终回复（persona_enforce 只清洗不改内容的前提下）
    const streamed = chunks.map((c) => c.payload.delta).join('')
    expect(done.payload.reply).toBe(streamed.trim() || done.payload.reply)
    expect(done.payload.bubble.length).toBeLessThanOrEqual(18)
  })

  it('对话轮次已落 SQLite（CHAT_HISTORY_GET 可回读）', async () => {
    const { turns } = await h.request('CHAT_HISTORY_GET', { limit: 10 })
    expect(turns.some((t: any) => t.role === 'user' && t.text === '你好呀')).toBe(true)
    expect(turns.some((t: any) => t.role === 'pet')).toBe(true)
  })

  it('新对话上下文按 conversationId 隔离', async () => {
    const first = await h.request('CHAT_SEND', { text: '旧上下文只属于 A', conversationId: 'conv-e2e-a' })
    await h.waitFor((e) => e.type === 'CHAT_DONE' && e.payload?.turnId === first.turnId, 15_000)

    const second = await h.request('CHAT_SEND', { text: '新上下文只属于 B', conversationId: 'conv-e2e-b' })
    expect(second.conversationId).toBe('conv-e2e-b')
    await h.waitFor((e) => e.type === 'CHAT_DONE' && e.payload?.turnId === second.turnId, 15_000)

    const a = await h.request('CHAT_HISTORY_GET', { limit: 20, conversationId: 'conv-e2e-a' })
    const b = await h.request('CHAT_HISTORY_GET', { limit: 20, conversationId: 'conv-e2e-b' })
    expect(a.turns.some((t: any) => t.text.includes('旧上下文只属于 A'))).toBe(true)
    expect(a.turns.some((t: any) => t.text.includes('新上下文只属于 B'))).toBe(false)
    expect(b.turns.some((t: any) => t.text.includes('新上下文只属于 B'))).toBe(true)
    expect(b.turns.some((t: any) => t.text.includes('旧上下文只属于 A'))).toBe(false)
  })
})

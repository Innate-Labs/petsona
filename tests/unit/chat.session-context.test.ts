import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LlmChatRequest } from '@petsona/shared'
import { SessionsDb } from '../../packages/harness/src/memory/sqlite.js'
import { CompanionLoop } from '../../packages/harness/src/loop/companion.js'

function waitForDone(events: Array<{ type: string; payload: any }>, turnId: string) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (events.some((event) => event.type === 'CHAT_DONE' && event.payload?.turnId === turnId)) {
        resolve()
        return
      }
      if (Date.now() - started > 2000) {
        reject(new Error('CHAT_DONE timeout'))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('chat conversation context boundaries', () => {
  it('stores and reads turns by explicit conversation id', () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-session-db-')), 'sessions.db'))
    db.insertTurn('user', '旧上下文消息', 1000, { conversationId: 'conv-old' })
    db.insertTurn('pet', '旧上下文回复', 1001, { conversationId: 'conv-old' })
    db.insertTurn('user', '新上下文消息', 2000, { conversationId: 'conv-new' })

    expect(db.recentTurnsByConversation('conv-new', 10).map((turn) => turn.text)).toEqual(['新上下文消息'])
    expect(db.recentTurnsByConversation('conv-old', 10).map((turn) => turn.text)).toEqual(['旧上下文消息', '旧上下文回复'])
    db.close()
  })

  it('builds LLM messages from the active conversation only', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-session-loop-')), 'sessions.db'))
    db.insertTurn('user', '旧对话里的项目背景', 1000, { conversationId: 'conv-old' })
    db.insertTurn('pet', '旧对话里的回复', 1001, { conversationId: 'conv-old' })

    const requests: LlmChatRequest[] = []
    const events: Array<{ type: string; payload: any }> = []
    const loop = new CompanionLoop({
      gateway: {
        chatStream: async (req: LlmChatRequest, cb: any) => {
          requests.push(req)
          cb.onDelta('新回复')
          cb.onDone({ stopReason: 'end_turn', usage: { in: 1, out: 1 } })
        },
      } as any,
      store: {
        db,
        assemble: () => ({ recentHot: [], topicHot: [], warm: [], cold: [] }),
        tagTurn: async (turn: any) => {
          db.setTurnTopics(turn.id, ['_untagged'])
          return ['_untagged']
        },
        compactIfNeeded: async () => {},
        extract: async () => [],
      } as any,
      registry: { toLlmTools: () => [] } as any,
      hooks: {
        trace: [],
        resetTrace: () => {},
        runPreTurn: async () => null,
        runPreLLM: async () => {},
        runPostLLM: async ({ text }: { text: string }) => ({ text, bubble: text }),
      } as any,
      queue: {} as any,
      pool: { pick: () => '兜底', forError: () => '出错了' } as any,
      tracker: { track: () => {} } as any,
      paths: { root: '', personas: '', skills: '', memoryIndex: '' } as any,
      emit: (event) => events.push(event),
      getEmotion: () => 'happy',
      getUserPersona: () => '',
    })

    const { turnId } = await loop.handleChatSend('这是新对话第一句', { conversationId: 'conv-new' })
    await waitForDone(events, turnId)

    const sentText = requests[0]!.messages.map((message) => message.content).join('\n')
    expect(sentText).toContain('这是新对话第一句')
    expect(sentText).not.toContain('旧对话里的项目背景')
    expect(db.recentTurnsByConversation('conv-new', 10).map((turn) => turn.text)).toEqual(['这是新对话第一句', '新回复'])
    db.close()
  })

  it('carries prior turns of the same conversation as the context window', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-session-ctx-')), 'sessions.db'))
    const { loop, requests, events } = makeLoop(db)

    const first = await loop.handleChatSend('我叫小鱼', { conversationId: 'conv-ctx' })
    await waitForDone(events, first.turnId)
    const second = await loop.handleChatSend('我叫什么？', { conversationId: 'conv-ctx' })
    await waitForDone(events, second.turnId)

    // 第二轮请求必须带上第一轮 user+pet 原文——「上下文窗口」的直接验收
    const secondSent = requests[1]!.messages.map((message) => message.content).join('\n')
    expect(secondSent).toContain('我叫小鱼')
    expect(secondSent).toContain('新回复')
    expect(secondSent).toContain('我叫什么？')
    db.close()
  })

  it('merges adjacent same-role messages (orphan user turns from error rounds)', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-session-merge-')), 'sessions.db'))
    // 模拟上一轮 CHAT_ERROR：user 落库了但 pet 回复没落 → 相邻两条 user
    db.insertTurn('user', '上一轮失败的话', 1000, { conversationId: 'conv-merge' })
    const { loop, requests, events } = makeLoop(db)

    const { turnId } = await loop.handleChatSend('新的一句', { conversationId: 'conv-merge' })
    await waitForDone(events, turnId)

    const sent = requests[0]!.messages
    for (let i = 1; i < sent.length; i += 1) {
      expect(sent[i]!.role).not.toBe(sent[i - 1]!.role)
    }
    const joined = sent.map((message) => message.content).join('\n')
    expect(joined).toContain('上一轮失败的话')
    expect(joined).toContain('新的一句')
    db.close()
  })

  it('retries a transient stream failure once instead of surfacing CHAT_ERROR', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-session-retry-')), 'sessions.db'))
    const { loop, requests, events } = makeLoop(db, { failFirstStream: true })

    const { turnId } = await loop.handleChatSend('网络抖一下', { conversationId: 'conv-retry' })
    await waitForDone(events, turnId)

    // 第一次断流 → 静默重试成功：共两次请求、无 CHAT_ERROR、正常 CHAT_DONE
    expect(requests).toHaveLength(2)
    expect(events.some((event) => event.type === 'CHAT_ERROR')).toBe(false)
    db.close()
  })
})

function makeLoop(db: SessionsDb, opts: { failFirstStream?: boolean } = {}) {
  const requests: LlmChatRequest[] = []
  const events: Array<{ type: string; payload: any }> = []
  const loop = new CompanionLoop({
    gateway: {
      chatStream: async (req: LlmChatRequest, cb: any) => {
        requests.push(req)
        if (opts.failFirstStream && requests.length === 1) {
          cb.onError({ code: 'UPSTREAM', message: 'mock 断流' })
          return
        }
        cb.onDelta('新回复')
        cb.onDone({ stopReason: 'end_turn', usage: { in: 1, out: 1 } })
      },
    } as any,
    store: {
      db,
      assemble: () => ({ recentHot: [], topicHot: [], warm: [], cold: [] }),
      tagTurn: async (turn: any) => {
        db.setTurnTopics(turn.id, ['_untagged'])
        return ['_untagged']
      },
      compactIfNeeded: async () => {},
      extract: async () => [],
    } as any,
    registry: { toLlmTools: () => [] } as any,
    hooks: {
      trace: [],
      resetTrace: () => {},
      runPreTurn: async () => null,
      runPreLLM: async () => {},
      runPostLLM: async ({ text }: { text: string }) => ({ text, bubble: text }),
    } as any,
    queue: {} as any,
    pool: { pick: () => '兜底', forError: () => '出错了' } as any,
    tracker: { track: () => {} } as any,
    paths: { root: '', personas: '', skills: '', memoryIndex: '' } as any,
    emit: (event) => events.push(event),
    getEmotion: () => 'happy' as const,
    getUserPersona: () => '',
  })
  return { loop, requests, events }
}

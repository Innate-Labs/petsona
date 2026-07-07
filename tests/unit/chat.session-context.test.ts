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
})

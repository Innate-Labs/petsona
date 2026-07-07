import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY_SESSION_GAP_MS, turnsToHistoryConversations } from '../../apps/shell/ui/managementPanelData'
import type { ChatMsg } from '../../apps/shell/ui/lib/useChat'

function msg(key: string, role: ChatMsg['role'], text: string, t: number): ChatMsg {
  return { key, role, text, t }
}

describe('history conversation grouping', () => {
  it('keeps multiple nearby turns in one conversation session', () => {
    const first = Date.UTC(2026, 6, 7, 10, 0)
    const second = first + 5 * 60_000
    const conversations = turnsToHistoryConversations([
      msg('u1', 'user', '今天我有点困', first),
      msg('p1', 'pet', '那先喝点水，慢慢来。', first + 10_000),
      msg('u2', 'user', '我还可以', second),
      msg('p2', 'pet', '嗯，窝陪你继续。', second + 10_000)
    ])

    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.id).toBe('session-u1')
    expect(conversations[0]?.title).toBe('今天我有点困')
    expect(conversations[0]?.messages.map((item) => item.key)).toEqual(['u1', 'p1', 'u2', 'p2'])
  })

  it('starts a new history conversation after a long idle gap', () => {
    const first = Date.UTC(2026, 6, 7, 10, 0)
    const second = first + CHAT_HISTORY_SESSION_GAP_MS + 60_000
    const conversations = turnsToHistoryConversations([
      msg('u1', 'user', '上午聊工作', first),
      msg('p1', 'pet', '收到。', first + 10_000),
      msg('u2', 'user', '晚上聊晚饭', second),
      msg('p2', 'pet', '今天吃点轻松的。', second + 10_000)
    ])

    expect(conversations).toHaveLength(2)
    expect(conversations.map((item) => item.id)).toEqual(['session-u2', 'session-u1'])
    expect(conversations.map((item) => item.messages.map((message) => message.key))).toEqual([
      ['u2', 'p2'],
      ['u1', 'p1']
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { PROACTIVE_CONVERSATION_ID, type ChatConversationSummary } from '@petsona/shared'
import { conversationsToHistory } from '../../apps/shell/ui/managementPanelData'

function summary(id: string, title: string, updatedAt: number, messageCount = 2): ChatConversationSummary {
  return { id, title, t: updatedAt - 60_000, updatedAt, messageCount }
}

describe('history conversation list (backend-sourced)', () => {
  it('maps backend summaries with their real conversation ids', () => {
    const now = Date.now()
    const conversations = conversationsToHistory([
      summary('conv-b', '第二条真实会话', now),
      summary('conv-a', '第一条真实会话', now - 3_600_000)
    ])

    expect(conversations.map((item) => item.id)).toEqual(['conv-b', 'conv-a'])
    expect(conversations[0]?.title).toBe('第二条真实会话')
    expect(conversations[0]?.messageCount).toBe(2)
  })

  it('filters the proactive-bubble conversation out of the visible history', () => {
    const now = Date.now()
    const conversations = conversationsToHistory([
      summary(PROACTIVE_CONVERSATION_ID, '主人主人！', now),
      summary('conv-a', '真实会话', now - 1_000)
    ])

    expect(conversations.map((item) => item.id)).toEqual(['conv-a'])
  })

  it('truncates long titles the same way the chat page does', () => {
    const conversations = conversationsToHistory([
      summary('conv-long', '这是一条特别特别长需要被截断的会话标题文本', Date.now())
    ])

    expect(conversations[0]?.title.endsWith('...')).toBe(true)
    expect(conversations[0]?.title.length).toBeLessThanOrEqual(19)
  })
})

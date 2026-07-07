import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const panel = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')
const useChat = readFileSync(join(ROOT, 'apps/shell/ui/lib/useChat.ts'), 'utf8')
const ipc = readFileSync(join(ROOT, 'packages/shared/src/ipc.ts'), 'utf8')
const data = readFileSync(join(ROOT, 'apps/shell/ui/managementPanelData.ts'), 'utf8')
const config = readFileSync(join(ROOT, 'packages/shared/src/config.ts'), 'utf8')

describe('ManagementPanel real chat wiring', () => {
  it('uses the shared IPC chat hook for panel home chat instead of local fake messages', () => {
    expect(panel).toContain("import { useChat } from './lib/useChat'")
    expect(panel).toContain('const { msgs, listRef, sendText')
    expect(panel).toContain('= useChat()')
    expect(panel).not.toContain('const [messages, setMessages]')
    expect(panel).not.toContain('setMessages((current) => [')
    expect(panel).toContain('if (sendText(inputValue)) setInputValue')
  })

  it('starts a real new chat context instead of only slicing visible messages', () => {
    expect(ipc).toContain("CHAT_CONVERSATION_START: 'CHAT_CONVERSATION_START'")
    expect(ipc).toContain('conversationId: string')
    expect(useChat).toContain('startConversation')
    expect(useChat).toContain('conversationId')
    expect(useChat).toContain('IPC.CHAT_CONVERSATION_START')
    expect(panel).toContain('startConversation')
    expect(panel).toContain('openChatConversation')
    expect(panel).toContain('const hasConversation = visibleMsgs.length > 0')
    expect(panel).toContain('void startConversation()')
    expect(panel).not.toContain('setChatStartIndex(msgs.length)')
    expect(panel).not.toContain('msgs.slice(chatStartIndex)')
    expect(panel).toContain('visibleMsgs.map((message)')
  })

  it('does not seed fake history conversations in the management panel data model', () => {
    expect(data).not.toContain('HISTORY_SEEDS')
    expect(data).not.toContain('窝先记住这条对话')
    expect(data).not.toContain('history: HISTORY_SEEDS')
    expect(data).toContain('history: []')
  })

  it('defines provider-aware llm debug config defaults', () => {
    expect(config).toContain("export type LlmProviderId = 'deepseek' | 'openai-compatible' | 'openrouter'")
    expect(config).toContain('provider: LlmProviderId')
    expect(config).toContain("provider: 'deepseek'")
    expect(config).toContain("baseUrl: 'https://api.deepseek.com/v1'")
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const main = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')
const floatChat = readFileSync(join(ROOT, 'apps/shell/ui/float/FloatChat.tsx'), 'utf8')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')
const shellLib = readFileSync(join(ROOT, 'apps/shell/src-tauri/src/lib.rs'), 'utf8')

describe('FloatChat real chat wiring', () => {
  it('renders the shared FloatChat route instead of the legacy local-message ChatView', () => {
    expect(main).toContain("import { FloatChat } from './float/FloatChat'")
    expect(main).toContain("if (view === 'chat') return <FloatChat />")
    expect(main).not.toContain('function ChatView()')
    expect(main).not.toContain('const [messages, setMessages]')
  })

  it('uses the shared IPC chat hook inside the float chat surface', () => {
    expect(floatChat).toContain("import { useChat } from '../lib/useChat'")
    expect(floatChat).toContain('const { msgs, conversations, listRef, sendText, startConversation, openConversation } = useChat()')
    expect(floatChat).toContain('if (sendText(input)) {')
    expect(floatChat).toContain("setInput('')")
  })

  it('offers a new-conversation button matching the home page flow', () => {
    expect(floatChat).toContain('const { msgs, conversations, listRef, sendText, startConversation, openConversation } = useChat()')
    expect(floatChat).toContain('className="chat-icon-button new-chat-button"')
    expect(floatChat).toContain('onClick={startNewChat}')
    // 与首页一致：开新会话 + 清输入 + 聚焦
    expect(floatChat).toContain('void startConversation()')
    expect(floatChat).toContain('window.requestAnimationFrame(() => textareaRef.current?.focus())')
    expect(styles).toContain('.new-chat-button')
  })

  it('keeps history, pin, and close as separate float chat actions', () => {
    expect(floatChat).toContain("import historyIcon from '../assets/figma/icon-history-18.svg'")
    expect(floatChat).toContain("historyMode === 'chat' ? 'chat-icon-button history-button' : 'chat-icon-button history-button active'")
    expect(floatChat).toContain('className="chat-icon-button pin-button"')
    expect(floatChat).toContain('className="chat-icon-button close-button"')
    expect(floatChat).toContain('onClick={openHistory}')
    expect(floatChat).toContain('onClick={togglePinned}')
    expect(floatChat).toContain('onClick={close}')
    expect(floatChat).toContain('setHistoryMode')
    expect(floatChat).not.toContain("invoke('open_panel', { route: 'chat' })")
    expect(floatChat).toContain('window.petAgent?.setChatPinned(nextPinned)')
    expect(floatChat).toContain('window.petAgent?.hideChat()')
  })

  it('uses demo-sized native window resizing and click-away close when not pinned', () => {
    expect(shellLib).toContain('const FLOAT_WIDTH: f64 = 300.0;')
    expect(shellLib).toContain('const FLOAT_HEIGHT: f64 = 425.0;')
    expect(shellLib).toContain('const FLOAT_MAX_WIDTH: f64 = 760.0;')
    expect(shellLib).toContain('const FLOAT_MAX_HEIGHT: f64 = 980.0;')
    expect(shellLib).toContain('.min_inner_size(FLOAT_WIDTH, FLOAT_HEIGHT)')
    expect(shellLib).toContain('.max_inner_size(FLOAT_MAX_WIDTH, FLOAT_MAX_HEIGHT)')
    expect(shellLib).toContain('.resizable(true)')
    expect(floatChat).not.toContain('chat-resize-handle')
    expect(floatChat).not.toContain('chat-resize-edge')
    expect(floatChat).not.toContain('chat-resize-corner')
    expect(floatChat).not.toContain('startResizeDragging')
    expect(floatChat).not.toContain('new LogicalSize')
    expect(floatChat).toContain("window.addEventListener('blur', closeIfUnpinned)")
    expect(floatChat).toContain('if (!pinned) close()')
    expect(styles).toContain('.chat-window {')
    expect(styles).toContain('padding: 0;')
    expect(styles).not.toContain('.chat-resize-handle')
    expect(styles).not.toContain('.chat-resize-edge')
    expect(styles).not.toContain('.chat-resize-corner')
  })

  it('right-aligns user message rows while keeping bubble text left-aligned', () => {
    expect(floatChat).toContain("className={`msg-wrap ${m.role === 'user' ? 'user' : 'pet'}`}")
    expect(styles).toContain('.msg-wrap.user')
    expect(styles).toContain('align-items: flex-end;')
    expect(styles).toContain('.message.user')
    expect(styles).toContain('text-align: left;')
  })

  it('renders an in-float history panel backed by the shared panel history model', () => {
    expect(floatChat).toContain("import { conversationsToHistory")
    expect(floatChat).toContain('const historyConversations = useMemo(() => conversationsToHistory(conversations)')
    expect(floatChat).toContain('void openConversation(conversation.id)')
    expect(floatChat).toContain('className="float-history-header-title"')
    expect(floatChat).toContain('className="float-history-panel"')
    expect(floatChat).toContain('className="float-history-row"')
    expect(floatChat).toContain('setSelectedHistoryId(conversation.id)')
    expect(floatChat).not.toContain('className="float-history-title"')
    expect(styles).toContain('.float-history-panel')
    expect(styles).toContain('.float-history-header-title')
    expect(styles).toContain('.float-history-row')
    expect(styles).toContain('background: transparent;')
    expect(styles).toContain('.float-history-row:hover')
    expect(styles).toContain('.history-button {')
    expect(styles).toContain('opacity: 0.3;')
    expect(styles).toContain('.history-button.active')
    expect(styles).toContain('opacity: 1;')
  })

  it('hides the input row and uses full-height scrolling while the history panel is open', () => {
    expect(floatChat).toContain("className={historyMode === 'list' ? 'chat-messages history-list' : 'chat-messages'}")
    expect(floatChat).toContain("{historyMode !== 'list' && (")
    expect(floatChat).toContain('<footer className="chat-input-row" style={{ height: inputHeight }}>')
    expect(styles).toContain('.chat-messages.history-list')
    expect(styles).toContain('bottom: 8px;')
    expect(styles).toContain('padding-bottom: 8px;')
    expect(styles).toContain('overflow-y: auto;')
  })

  it('keeps the floating panel shadow on the panel itself', () => {
    expect(shellLib).toContain('.shadow(true)')
    expect(styles).toContain('.chat-shell {')
    expect(styles).toContain('box-shadow:')
  })

  it('mirrors the demo input-height drag behavior inside the float chat', () => {
    expect(floatChat).toContain('const MIN_CHAT_INPUT_HEIGHT = 118')
    expect(floatChat).toContain('const MAX_CHAT_INPUT_HEIGHT = 236')
    expect(floatChat).toContain('const CHAT_INPUT_CHROME_HEIGHT = 72')
    expect(floatChat).toContain('const [inputHeight, setInputHeight] = useState(MIN_CHAT_INPUT_HEIGHT)')
    expect(floatChat).toContain('const textareaRef = useRef<HTMLTextAreaElement | null>(null)')
    expect(floatChat).toContain('const startInputResize = (event: ReactPointerEvent<HTMLDivElement>)')
    expect(floatChat).toContain("style={{ '--chat-input-height': `${inputHeight}px` } as CSSProperties}")
    expect(floatChat).toContain('className="chat-input-resize-handle"')
    expect(floatChat).toContain('style={{ height: inputHeight }}')
    expect(styles).toContain('.chat-input-resize-handle')
    expect(styles).toContain('cursor: ns-resize;')
  })
})

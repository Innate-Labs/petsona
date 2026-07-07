// float/FloatChat.tsx —— 对话浮窗（Figma Group12/54：300×425）：宠物旁快捷聊天
// 浏览器原型与 Tauri 独立小窗共用同一路由。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../lib/ipc'
import { useChat } from '../lib/useChat'
import { loadProfile } from '../lib/local'
import { turnsToHistoryConversations, type HistoryConversation } from '../managementPanelData'
import historyIcon from '../assets/figma/icon-history-18.svg'
import avatarIcon from '../assets/demo-chat-icons/头像.png'
import closeDefaultIcon from '../assets/demo-chat-icons/关闭=默认.png'
import closeHoverIcon from '../assets/demo-chat-icons/关闭=悬停.png'
import pinDefaultIcon from '../assets/demo-chat-icons/钉住=默认-1.png'
import pinHoverIcon from '../assets/demo-chat-icons/钉住=悬停-1.png'
import pinActiveIcon from '../assets/demo-chat-icons/钉住=钉住.png'
import sendDefaultIcon from '../assets/demo-chat-icons/发送按钮-默认.png'
import sendActiveIcon from '../assets/demo-chat-icons/发送按钮-输入后可发送.png'

const MIN_CHAT_INPUT_HEIGHT = 118
const MAX_CHAT_INPUT_HEIGHT = 236
const CHAT_INPUT_CHROME_HEIGHT = 72

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function FloatChat() {
  const { msgs, listRef, sendText } = useChat()
  const [pinned, setPinned] = useState(false)
  const [historyMode, setHistoryMode] = useState<'chat' | 'list' | 'detail'>('chat')
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [inputHeight, setInputHeight] = useState(MIN_CHAT_INPUT_HEIGHT)
  const [pinHovering, setPinHovering] = useState(false)
  const [closeHovering, setCloseHovering] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const name = loadProfile().name
  const hasInput = input.trim().length > 0
  const historyConversations = useMemo(() => turnsToHistoryConversations(msgs), [msgs])
  const selectedHistory = selectedHistoryId ? historyConversations.find((conversation) => conversation.id === selectedHistoryId) ?? null : null
  const visibleMsgs = selectedHistory ? selectedHistory.messages : msgs

  const submit = () => {
    if (sendText(input)) {
      setInput('')
      setInputHeight(MIN_CHAT_INPUT_HEIGHT)
    }
    setHistoryMode('chat')
    setSelectedHistoryId(null)
  }

  const openHistory = () => {
    setHistoryMode((mode) => (mode === 'chat' ? 'list' : 'chat'))
    setSelectedHistoryId(null)
  }

  const close = () => {
    if (window.petAgent) {
      void window.petAgent?.hideChat()
      return
    }
    if (isTauri()) void invoke('close_float_chat')
    else window.location.hash = '#/pet'
  }

  const togglePinned = () => {
    const nextPinned = !pinned
    setPinned(nextPinned)
    void window.petAgent?.setChatPinned(nextPinned)
  }

  const openHome = () => {
    if (isTauri()) void invoke('open_panel', { route: 'panel' })
    else window.location.hash = '#/panel'
  }

  const startInputResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startHeight = inputHeight

    const resize = (moveEvent: PointerEvent) => {
      setInputHeight(clamp(startHeight + startY - moveEvent.clientY, MIN_CHAT_INPUT_HEIGHT, MAX_CHAT_INPUT_HEIGHT))
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  useEffect(() => window.petAgent?.onPinnedChanged(setPinned), [])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const nextTextHeight = Math.max(46, textarea.scrollHeight)
    setInputHeight((current) => {
      const autoHeight = clamp(nextTextHeight + CHAT_INPUT_CHROME_HEIGHT, MIN_CHAT_INPUT_HEIGHT, MAX_CHAT_INPUT_HEIGHT)
      return Math.max(current > autoHeight && input ? current : autoHeight, MIN_CHAT_INPUT_HEIGHT)
    })
  }, [input])

  useEffect(() => {
    const closeIfUnpinned = () => {
      if (!pinned) close()
    }
    window.addEventListener('blur', closeIfUnpinned)
    return () => window.removeEventListener('blur', closeIfUnpinned)
  }, [pinned])

  return (
    <main
      className={pinned ? 'chat-window pinned' : 'chat-window'}
      onPointerDown={(event) => {
        if (!pinned && event.target === event.currentTarget) close()
      }}
    >
      <section className="chat-shell" style={{ '--chat-input-height': `${inputHeight}px` } as CSSProperties}>
        <header className="chat-header" data-tauri-drag-region>
          <button className="chat-avatar-button" type="button" onClick={openHome} aria-label={`打开 ${name} 的面板`}>
            <img className="chat-avatar" src={avatarIcon} alt="" />
          </button>
          {historyMode !== 'chat' && (
            <div className="float-history-header-title">{historyMode === 'detail' && selectedHistory ? selectedHistory.title : '历史对话'}</div>
          )}
          <button
            className={historyMode === 'chat' ? 'chat-icon-button history-button' : 'chat-icon-button history-button active'}
            type="button"
            onClick={openHistory}
            aria-label="打开历史对话"
            title="历史对话"
          >
            <img src={historyIcon} alt="" />
          </button>
          <button
            className="chat-icon-button pin-button"
            type="button"
            onClick={togglePinned}
            onMouseEnter={() => setPinHovering(true)}
            onMouseLeave={() => setPinHovering(false)}
            aria-label={pinned ? '取消置顶聊天窗' : '置顶聊天窗'}
            title={pinned ? '取消置顶' : '置顶'}
          >
            <img src={pinned ? pinActiveIcon : pinHovering ? pinHoverIcon : pinDefaultIcon} alt="" />
          </button>
          <button
            className="chat-icon-button close-button"
            type="button"
            onClick={close}
            onMouseEnter={() => setCloseHovering(true)}
            onMouseLeave={() => setCloseHovering(false)}
            aria-label="关闭聊天窗"
            title="关闭"
          >
            <img src={closeHovering ? closeHoverIcon : closeDefaultIcon} alt="" />
          </button>
        </header>

        <section className={historyMode === 'list' ? 'chat-messages history-list' : 'chat-messages'} ref={listRef} aria-label="聊天消息">
          {historyMode === 'list' ? (
            <FloatHistoryPanel
              conversations={historyConversations}
              onOpen={(conversation) => {
                setSelectedHistoryId(conversation.id)
                setHistoryMode('chat')
              }}
            />
          ) : (
            <>
              {historyMode === 'detail' && selectedHistory ? (
                <div className="float-history-detail-header">
                  <button type="button" onClick={() => setHistoryMode('list')}>历史对话</button>
                  <span>{selectedHistory.title}</span>
                </div>
              ) : null}
              {visibleMsgs.length === 0 && <article className="message pet">人，咪想你…</article>}
              {visibleMsgs.map((m) => (
                <div key={m.key} className={`msg-wrap ${m.role === 'user' ? 'user' : 'pet'}`}>
                  {m.reasoning && !m.text && <div className="float-reasoning">{name} 正在来的路上…</div>}
                  {(m.text || !m.reasoning) && (
                    <article className={`message ${m.role === 'user' ? 'user' : 'pet'}${m.error ? ' error' : ''}`}>
                      {m.text}
                      {m.streaming && <span className="chat-cursor">▍</span>}
                    </article>
                  )}
                  {m.tooling && <div className="float-tooling">{m.tooling}</div>}
                </div>
              ))}
            </>
          )}
        </section>

        {historyMode !== 'list' && (
          <footer className="chat-input-row" style={{ height: inputHeight }}>
            <div
              className="chat-input-resize-handle"
              role="separator"
              aria-label="调整输入框高度"
              aria-orientation="horizontal"
              onPointerDown={startInputResize}
            />
            <textarea
              ref={textareaRef}
              aria-label="聊天输入"
              value={input}
              placeholder={inputFocused ? '' : '聊聊拯救地球の事'}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <button className="send-button" type="button" aria-label="发送消息" disabled={!hasInput} onClick={submit}>
              <img src={hasInput ? sendActiveIcon : sendDefaultIcon} alt="" />
            </button>
          </footer>
        )}
      </section>
    </main>
  )
}

function FloatHistoryPanel({
  conversations,
  onOpen,
}: {
  conversations: HistoryConversation[]
  onOpen: (conversation: HistoryConversation) => void
}) {
  const groups: HistoryConversation['group'][] = ['今天', '昨天', '本周', '本月', '更早']
  return (
    <div className="float-history-panel">
      {conversations.length === 0 ? (
        <div className="float-history-empty">还没有历史对话</div>
      ) : (
        groups.map((group) => {
          const rows = conversations.filter((conversation) => conversation.group === group)
          if (!rows.length) return null
          return (
            <section className="float-history-group" key={group}>
              <h2>{group}</h2>
              {rows.map((conversation) => (
                <button className="float-history-row" type="button" key={conversation.id} onClick={() => onOpen(conversation)}>
                  <span>{conversation.title}</span>
                  <small>{conversation.timeLabel}</small>
                </button>
              ))}
            </section>
          )
        })
      )}
    </div>
  )
}

// float/FloatChat.tsx —— 对话浮窗（Figma Group12/54：300×425）：宠物旁快捷聊天
// 浏览器原型与 Tauri 独立小窗共用同一路由。

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../lib/ipc'
import { useChat } from '../lib/useChat'
import { loadProfile } from '../lib/local'
import avatarIcon from '../assets/demo-chat-icons/头像.png'
import closeDefaultIcon from '../assets/demo-chat-icons/关闭=默认.png'
import closeHoverIcon from '../assets/demo-chat-icons/关闭=悬停.png'
import pinDefaultIcon from '../assets/demo-chat-icons/钉住=默认-1.png'
import pinHoverIcon from '../assets/demo-chat-icons/钉住=悬停-1.png'
import sendDefaultIcon from '../assets/demo-chat-icons/发送按钮-默认.png'
import sendActiveIcon from '../assets/demo-chat-icons/发送按钮-输入后可发送.png'

export function FloatChat() {
  const { msgs, listRef, sendText } = useChat()
  const [input, setInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [historyHovering, setHistoryHovering] = useState(false)
  const [closeHovering, setCloseHovering] = useState(false)
  const name = loadProfile().name
  const hasInput = input.trim().length > 0

  const submit = () => {
    if (sendText(input)) setInput('')
  }

  const openHistory = () => {
    if (isTauri()) void invoke('open_panel', { route: 'chat' })
    else window.location.hash = '#/panel/chat'
  }

  const close = () => {
    if (isTauri()) void invoke('close_float_chat')
    else window.location.hash = '#/pet' // 浏览器原型回宠物视图
  }

  const openHome = () => {
    if (isTauri()) void invoke('open_panel', { route: 'panel' })
    else window.location.hash = '#/panel'
  }

  return (
    <main className="chat-window">
      <section className="chat-shell">
        <header className="chat-header" data-tauri-drag-region>
          <button className="chat-avatar-button" type="button" onClick={openHome} aria-label={`打开 ${name} 的面板`}>
            <img className="chat-avatar" src={avatarIcon} alt="" />
          </button>
          <button
            className="chat-icon-button pin-button"
            type="button"
            onClick={openHistory}
            onMouseEnter={() => setHistoryHovering(true)}
            onMouseLeave={() => setHistoryHovering(false)}
            aria-label="打开历史对话"
            title="历史对话"
          >
            <img src={historyHovering ? pinHoverIcon : pinDefaultIcon} alt="" />
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

        <section className="chat-messages" ref={listRef} aria-label="聊天消息">
          {msgs.length === 0 && <article className="message pet">人，咪想你…</article>}
          {msgs.map((m) => (
            <div key={m.key} className="msg-wrap">
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
        </section>

        <footer className="chat-input-row">
          <textarea
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
      </section>
    </main>
  )
}

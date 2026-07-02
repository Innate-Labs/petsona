// float/FloatChat.tsx —— 对话浮窗（Figma Group12/54：300×425）：宠物旁快捷聊天
// SPEC-GAP: 真机应为独立 NSPanel 小窗（壳侧开窗待补），M1 先作 #/float 路由供
// 浏览器原型演示与后续壳接入复用。

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../lib/ipc'
import { useChat } from '../lib/useChat'
import { loadProfile } from '../lib/local'
import { PetAvatar } from '../panel/kit'
import iconHistory from '../assets/figma/icon-history-18.svg'
import iconClose from '../assets/figma/icon-close-18.svg'
import iconSend from '../assets/figma/icon-send-hover-28.svg'
import iconSendGray from '../assets/figma/icon-send-gray-28.svg'
import pillCircle from '../assets/figma/pill-circle-29.svg'

export function FloatChat() {
  const { msgs, listRef, sendText } = useChat()
  const [input, setInput] = useState('')
  const name = loadProfile().name

  const submit = () => {
    if (sendText(input)) setInput('')
  }

  const openHistory = () => {
    if (isTauri()) void invoke('open_panel', { route: 'chat' })
    else window.location.hash = '#/panel/chat'
  }

  const close = () => {
    if (!isTauri()) window.location.hash = '#/pet' // 浏览器原型回宠物视图
  }

  return (
    <div className="float-chat">
      <div className="float-head">
        <PetAvatar />
        <span className="float-head-name">{name}</span>
        <span className="float-head-spacer" />
        <button className="icon-btn" onClick={openHistory} aria-label="历史对话">
          <img src={iconHistory} alt="" />
        </button>
        <button className="icon-btn" onClick={close} aria-label="关闭">
          <img src={iconClose} alt="" />
        </button>
      </div>
      <div className="float-list" ref={listRef}>
        {msgs.length === 0 && <div className="float-msg">人，咪想你…</div>}
        {msgs.map((m) => (
          <div key={m.key} className="msg-wrap">
            <div
              className={`float-msg${m.role === 'user' ? ' float-msg--user' : ''}${m.error ? ' float-msg--error' : ''}`}
            >
              {m.text}
              {m.streaming && <span className="chat-cursor">▍</span>}
            </div>
            {m.tooling && <div className="float-tooling">{m.tooling}</div>}
          </div>
        ))}
      </div>
      <div className="super-input">
        <textarea
          value={input}
          placeholder="我想知道你在想什么，小咪～"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="super-input-row">
          <button className="super-pill" disabled title="M2 交付">
            <img src={pillCircle} alt="" />
            总结网页
          </button>
          <button className="send-btn" onClick={submit} aria-label="发送">
            <img src={input.trim() ? iconSend : iconSendGray} alt="" />
          </button>
        </div>
      </div>
    </div>
  )
}

// panel/Chat.tsx —— 对话记录页（Figma 82:2237 气泡风）：实时线程 + 流式渲染
// SPEC-GAP: Figma 稿含「今日/历史对话」会话列表，M1 harness 无多会话域，先渲染单线程；
// 会话列表随 M2 会话管理落地。

import { useEffect, useRef, useState } from 'react'
import { useChat } from '../lib/useChat'
import { popChatSeed } from '../lib/chatSeed'
import iconSend from '../assets/figma/icon-send-hover-28.svg'
import iconSendGray from '../assets/figma/icon-send-gray-28.svg'
import pillCircle from '../assets/figma/pill-circle-29.svg'

export function Chat() {
  const { msgs, listRef, sendText } = useChat()
  const [input, setInput] = useState('')
  // React 18 严格模式下 useEffect 会挂载→卸载→再挂载；用 ref 保证 seed 只消费一次
  const seedConsumed = useRef(false)

  useEffect(() => {
    if (seedConsumed.current) return
    seedConsumed.current = true
    const seed = popChatSeed()
    if (seed) sendText(seed)
  }, [sendText])

  const submit = () => {
    if (sendText(input)) setInput('')
  }

  return (
    <div className="chat-page">
      <div className="float-list chat-page-list" ref={listRef}>
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
          placeholder="和小咪聊聊拯救地球の事"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // isComposing：中文输入法回车确认候选词不触发发送
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="super-input-row">
          {/* 总结网页：read_context 屏幕问答 M2 交付，置灰占位（Figma 置灰态） */}
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

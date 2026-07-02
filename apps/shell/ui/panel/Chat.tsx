// panel/Chat.tsx —— 人格聊天面板（§4 人格聊天行）：流式渲染 + 历史回填

import { useEffect, useRef, useState } from 'react'
import { IPC, TRACK } from '@petsona/shared'
import type {
  ChatChunkPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatHistoryGetPayload,
  ChatHistoryGetRes,
  ChatSendPayload,
  ChatToolingPayload,
} from '@petsona/shared'
import { IpcError, on, request } from '../lib/ipc'
import { track } from '../lib/track'

type Msg = {
  key: string
  role: 'user' | 'pet'
  text: string
  streaming?: boolean
  error?: boolean
  tooling?: string // 轻工具过场提示（灰色小字），定稿后清除
}

const turnKey = (turnId: string) => `turn:${turnId}`

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  // 按 turnId 聚合流式事件：消息不存在则建、存在则改。
  // 为什么用函数式 setMsgs：CHUNK 事件到达密集，避免闭包里读到过期列表。
  const upsertTurn = (turnId: string, patch: (prev: Msg) => Msg) => {
    setMsgs((prev) => {
      const key = turnKey(turnId)
      const i = prev.findIndex((m) => m.key === key)
      if (i < 0) return [...prev, patch({ key, role: 'pet', text: '' })]
      const next = [...prev]
      next[i] = patch(next[i]!)
      return next
    })
  }

  useEffect(() => {
    const histReq: ChatHistoryGetPayload = { limit: 50 }
    void request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, histReq)
      .then((res) => setMsgs(res.turns.map((t) => ({ key: `hist:${t.id}`, role: t.role, text: t.text }))))
      .catch(() => {
        // 历史拉不到不阻塞聊天：harness 恢复后新消息照常收发
      })
    const unsubs = [
      on<ChatChunkPayload>(IPC.CHAT_CHUNK, (p) =>
        upsertTurn(p.turnId, (m) => ({ ...m, text: m.text + p.delta, streaming: true })),
      ),
      on<ChatToolingPayload>(IPC.CHAT_TOOLING, (p) => upsertTurn(p.turnId, (m) => ({ ...m, tooling: p.note }))),
      // 为什么定稿用 reply 整体覆盖：persona enforce 可能改写流式中间产物，CHAT_DONE 才是唯一定稿
      on<ChatDonePayload>(IPC.CHAT_DONE, (p) =>
        upsertTurn(p.turnId, (m) => ({ ...m, text: p.reply, streaming: false, tooling: undefined })),
      ),
      // petLine 来自 harness 兜底文案池（§7），UI 直接展示、不自造文案
      on<ChatErrorPayload>(IPC.CHAT_ERROR, (p) =>
        upsertTurn(p.turnId, (m) => ({ ...m, text: p.petLine, streaming: false, error: true, tooling: undefined })),
      ),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight // 新内容始终贴底
  }, [msgs])

  const sendText = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setMsgs((prev) => [...prev, { key: `user:${Date.now()}:${prev.length}`, role: 'user', text }])
    track(TRACK.对话_发起, {})
    const payload: ChatSendPayload = { text }
    void request(IPC.CHAT_SEND, payload).catch((e: unknown) => {
      // req 本身失败（超时/sidecar 掉线）走不到 CHAT_ERROR，这里只标错误码；
      // 人格化兜底文案属于 harness 职责，UI 不重复实现
      const code = e instanceof IpcError ? e.code : 'UPSTREAM'
      setMsgs((prev) => [...prev, { key: `err:${Date.now()}`, role: 'pet', text: `[${code}] 发送失败`, error: true }])
    })
  }

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {msgs.map((m) => (
          <div key={m.key} className={`chat-msg chat-msg--${m.role}${m.error ? ' chat-msg--error' : ''}`}>
            <div className="chat-bubble">
              {m.text}
              {m.streaming && <span className="chat-cursor">▍</span>}
            </div>
            {m.tooling && <div className="chat-tooling">{m.tooling}</div>}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={input}
          placeholder="和宠物说点什么…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 为什么查 isComposing：中文输入法回车确认候选词不应触发发送
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendText()
          }}
        />
        <button onClick={sendText}>发送</button>
      </div>
    </div>
  )
}

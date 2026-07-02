// lib/useChat.ts —— 聊天状态 hook：流式聚合 + 历史回填 + 发送
// 为什么抽 hook：面板「对话记录」页与宠物侧「对话浮窗」共用同一 IPC 逻辑，只有壳不同。

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
import { IpcError, on, request } from './ipc'
import { track } from './track'

export type ChatMsg = {
  key: string
  role: 'user' | 'pet'
  text: string
  streaming?: boolean
  error?: boolean
  tooling?: string
}

const turnKey = (turnId: string) => `turn:${turnId}`

export function useChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)

  // 按 turnId 聚合流式事件；函数式 setMsgs 防 CHUNK 密集到达读到过期列表
  const upsertTurn = (turnId: string, patch: (prev: ChatMsg) => ChatMsg) => {
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
        // 历史拉不到不阻塞聊天
      })
    const unsubs = [
      on<ChatChunkPayload>(IPC.CHAT_CHUNK, (p) =>
        upsertTurn(p.turnId, (m) => ({ ...m, text: m.text + p.delta, streaming: true })),
      ),
      on<ChatToolingPayload>(IPC.CHAT_TOOLING, (p) => upsertTurn(p.turnId, (m) => ({ ...m, tooling: p.note }))),
      // CHAT_DONE 用 reply 整体覆盖：persona enforce 可能改写流式中间产物
      on<ChatDonePayload>(IPC.CHAT_DONE, (p) =>
        upsertTurn(p.turnId, (m) => ({ ...m, text: p.reply, streaming: false, tooling: undefined })),
      ),
      on<ChatErrorPayload>(IPC.CHAT_ERROR, (p) =>
        upsertTurn(p.turnId, (m) => ({ ...m, text: p.petLine, streaming: false, error: true, tooling: undefined })),
      ),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight // 新内容贴底
  }, [msgs])

  const sendText = (raw: string): boolean => {
    const text = raw.trim()
    if (!text) return false
    setMsgs((prev) => [...prev, { key: `user:${Date.now()}:${prev.length}`, role: 'user', text }])
    track(TRACK.对话_发起, {})
    const payload: ChatSendPayload = { text }
    void request(IPC.CHAT_SEND, payload).catch((e: unknown) => {
      // req 失败（超时/sidecar 掉线）走不到 CHAT_ERROR；人格化兜底是 harness 职责
      const code = e instanceof IpcError ? e.code : 'UPSTREAM'
      setMsgs((prev) => [...prev, { key: `err:${Date.now()}`, role: 'pet', text: `[${code}] 发送失败`, error: true }])
    })
    return true
  }

  return { msgs, listRef, sendText }
}

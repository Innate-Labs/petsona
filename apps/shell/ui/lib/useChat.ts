// lib/useChat.ts —— 聊天状态 hook：流式聚合 + 历史回填 + 发送
// 为什么抽 hook：面板「对话记录」页与宠物侧「对话浮窗」共用同一 IPC 逻辑，只有壳不同。

import { useEffect, useRef, useState } from 'react'
import { IPC, TRACK } from '@petsona/shared'
import type {
  ChatChunkPayload,
  ChatConversationStartRes,
  ChatDonePayload,
  ChatErrorPayload,
  ChatHistoryGetPayload,
  ChatHistoryGetRes,
  ChatReasoningPayload,
  ChatSendPayload,
  ChatToolingPayload,
} from '@petsona/shared'
import { IpcError, on, request } from './ipc'
import { track } from './track'

export type ChatMsg = {
  key: string
  conversationId?: string
  role: 'user' | 'pet'
  text: string
  t?: number
  streaming?: boolean
  error?: boolean
  tooling?: string
  // reasoning 类模型（DeepSeek R1/v4-flash）思考流指示：仅作 loading 布尔位，
  // 内容不外露（避免暴露内部推理链），有正文/done/error 到达即翻回 false
  reasoning?: boolean
}

const turnKey = (turnId: string) => `turn:${turnId}`

export function useChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const conversationRef = useRef<string | null>(null)

  const setActiveConversation = (id: string | null) => {
    conversationRef.current = id
    setConversationId(id)
  }

  // 按 turnId 聚合流式事件；函数式 setMsgs 防 CHUNK 密集到达读到过期列表
  const upsertTurn = (turnId: string, eventConversationId: string | undefined, patch: (prev: ChatMsg) => ChatMsg) => {
    const active = conversationRef.current
    if (active && eventConversationId && eventConversationId !== active) return
    setMsgs((prev) => {
      const key = turnKey(turnId)
      const i = prev.findIndex((m) => m.key === key)
      if (i < 0) return [...prev, patch({ key, conversationId: eventConversationId, role: 'pet', text: '' })]
      const next = [...prev]
      next[i] = patch(next[i]!)
      return next
    })
  }

  useEffect(() => {
    const histReq: ChatHistoryGetPayload = { limit: 50, includeConversations: true }
    void request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, histReq)
      .then((res) => setMsgs(res.turns.map((t) => ({
        key: `hist:${t.id}`,
        conversationId: t.conversationId,
        role: t.role,
        text: t.text,
        t: t.t,
      }))))
      .catch(() => {
        // 历史拉不到不阻塞聊天
      })
    const unsubs = [
      on<ChatChunkPayload>(IPC.CHAT_CHUNK, (p) =>
        upsertTurn(p.turnId, p.conversationId, (m) => ({ ...m, conversationId: p.conversationId ?? m.conversationId, text: m.text + p.delta, streaming: true })),
      ),
      // reasoning 只翻布尔位——不落 delta 文本，避免长思考链在气泡里暴露
      on<ChatReasoningPayload>(IPC.CHAT_REASONING, (p) =>
        upsertTurn(p.turnId, p.conversationId, (m) => ({ ...m, conversationId: p.conversationId ?? m.conversationId, reasoning: true, streaming: true })),
      ),
      on<ChatToolingPayload>(IPC.CHAT_TOOLING, (p) => upsertTurn(p.turnId, p.conversationId, (m) => ({ ...m, conversationId: p.conversationId ?? m.conversationId, tooling: p.note }))),
      // CHAT_DONE 用 reply 整体覆盖：persona enforce 可能改写流式中间产物；
      // reasoning 一并翻回 false，让「正在来的路上」loading 撤下
      on<ChatDonePayload>(IPC.CHAT_DONE, (p) =>
        upsertTurn(p.turnId, p.conversationId, (m) => ({ ...m, conversationId: p.conversationId ?? m.conversationId, text: p.reply, streaming: false, tooling: undefined, reasoning: false })),
      ),
      on<ChatErrorPayload>(IPC.CHAT_ERROR, (p) =>
        upsertTurn(p.turnId, p.conversationId, (m) => ({ ...m, conversationId: p.conversationId ?? m.conversationId, text: p.petLine, streaming: false, error: true, tooling: undefined, reasoning: false })),
      ),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight // 新内容贴底
  }, [msgs])

  const startConversation = async (): Promise<string> => {
    const nextId = `conv_${crypto.randomUUID().slice(0, 8)}`
    setActiveConversation(nextId)
    setMsgs([])
    await request<ChatConversationStartRes>(IPC.CHAT_CONVERSATION_START, { conversationId: nextId }).catch(() => ({ conversationId: nextId }))
    return nextId
  }

  const openConversation = (id: string, messages: ChatMsg[]) => {
    setActiveConversation(id)
    setMsgs(messages)
  }

  const sendText = (raw: string): boolean => {
    const text = raw.trim()
    if (!text) return false
    const createdAt = Date.now()
    const activeConversationId = conversationRef.current ?? undefined
    // 用户消息 + 立即挂宠物占位（reasoning=true → 触发「宠物名 正在来的路上…」loading）
    // 为什么不等 CHAT_SEND res：res 至少要 IPC 往返（10-100ms），而首帧上游返回要 500ms+，
    // 用户敲完回车立刻要有回应；等 res 回来只是拿真 turnId 再 rekey 占位。
    const tempPetKey = `pet-pending:${Date.now()}`
    setMsgs((prev) => [
      ...prev,
      { key: `user:${createdAt}:${prev.length}`, conversationId: activeConversationId, role: 'user', text, t: createdAt },
      { key: tempPetKey, conversationId: activeConversationId, role: 'pet', text: '', t: createdAt, reasoning: true, streaming: true },
    ])
    track(TRACK.对话_发起, {})
    const payload: ChatSendPayload = { text, conversationId: activeConversationId }
    void request<{ turnId: string; conversationId?: string }>(IPC.CHAT_SEND, payload)
      .then((res) => {
        if (res.conversationId && conversationRef.current === null) setActiveConversation(res.conversationId)
        // 用真实 turnId 键替换 pending 占位；若极端竞态里真 msg 已由 CHUNK/REASONING 事件建过，
        // 只需删掉 pending，避免两个宠物气泡并列
        setMsgs((prev) => {
          const petKey = turnKey(res.turnId)
          const hasReal = prev.some((m) => m.key === petKey)
          if (hasReal) return prev.filter((m) => m.key !== tempPetKey)
          return prev.map((m) => (
            m.key === tempPetKey || (m.key.startsWith(`user:${createdAt}:`) && res.conversationId)
              ? { ...m, key: m.key === tempPetKey ? petKey : m.key, conversationId: res.conversationId ?? m.conversationId, t: m.key === tempPetKey ? Date.now() : m.t }
              : m
          ))
        })
      })
      .catch((e: unknown) => {
        // req 失败（超时/sidecar 掉线）走不到 CHAT_ERROR；把占位就地转成错误气泡
        const code = e instanceof IpcError ? e.code : 'UPSTREAM'
        setMsgs((prev) => prev.map((m) => m.key === tempPetKey
          ? { ...m, text: `[${code}] 发送失败`, error: true, reasoning: false, streaming: false }
          : m,
        ))
      })
    return true
  }

  return { msgs, conversationId, listRef, sendText, startConversation, openConversation }
}

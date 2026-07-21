// lib/useChat.ts —— 聊天状态 hook：流式聚合 + 会话管理 + 发送
// 为什么抽 hook：面板「对话记录」页与宠物侧「对话浮窗」共用同一 IPC 逻辑，只有壳不同。
// 会话模型（参考 CodeWhale：历史真源在后端）：
//   - msgs 只装「当前会话」的消息；历史列表用后端 recentConversations，不在前端按时间猜分组
//   - 发送永远显式带 conversationId（没有就先本地生成），后端按该 id 取近 N 轮做上下文窗口
//   - 打开历史会话 = 按 id 从后端拉该会话消息整体替换（上下文自然衔接）

import { useEffect, useRef, useState } from 'react'
import { IPC, PROACTIVE_CONVERSATION_ID, TRACK } from '@petsona/shared'
import type {
  ChatChunkPayload,
  ChatConversationStartRes,
  ChatConversationSummary,
  ChatDonePayload,
  ChatErrorPayload,
  ChatHistoryGetPayload,
  ChatHistoryGetRes,
  ChatReasoningPayload,
  ChatSendPayload,
  ChatToolingPayload,
  Turn,
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
const CONVERSATION_TURNS_LIMIT = 200

const newConversationId = () => `conv_${crypto.randomUUID().slice(0, 8)}`

const turnsToMsgs = (turns: Turn[]): ChatMsg[] =>
  turns.map((t) => ({
    key: `hist:${t.id}`,
    conversationId: t.conversationId,
    role: t.role,
    text: t.text,
    t: t.t,
  }))

export function useChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const conversationRef = useRef<string | null>(null)

  const setActiveConversation = (id: string | null) => {
    conversationRef.current = id
    setConversationId(id)
  }

  const refreshConversations = () => {
    const req: ChatHistoryGetPayload = { limit: 1, includeConversations: true }
    void request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, req)
      .then((res) => setConversations(res.conversations ?? []))
      .catch(() => {
        // 会话列表拉不到不阻塞聊天
      })
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
    // 启动即恢复最近一次会话（跳过主动气泡专用会话），当前对话不再是「全部历史大杂烩」
    void request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, {
      limit: 1,
      includeConversations: true,
    } satisfies ChatHistoryGetPayload)
      .then(async (res) => {
        setConversations(res.conversations ?? [])
        const latest = (res.conversations ?? []).find((c) => c.id !== PROACTIVE_CONVERSATION_ID)
        if (!latest || conversationRef.current !== null) return
        const detail = await request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, {
          limit: CONVERSATION_TURNS_LIMIT,
          conversationId: latest.id,
        } satisfies ChatHistoryGetPayload)
        // 恢复期间用户可能已抢先发言/新建会话，别覆盖
        if (conversationRef.current !== null) return
        setActiveConversation(latest.id)
        setMsgs(turnsToMsgs(detail.turns))
      })
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
      on<ChatDonePayload>(IPC.CHAT_DONE, (p) => {
        upsertTurn(p.turnId, p.conversationId, (m) => ({ ...m, conversationId: p.conversationId ?? m.conversationId, text: p.reply, streaming: false, tooling: undefined, reasoning: false }))
        refreshConversations() // 新会话出现/标题与排序更新
      }),
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
    const nextId = newConversationId()
    setActiveConversation(nextId)
    setMsgs([])
    await request<ChatConversationStartRes>(IPC.CHAT_CONVERSATION_START, { conversationId: nextId }).catch(() => ({ conversationId: nextId }))
    return nextId
  }

  /** 打开历史会话：按真实 conversationId 从后端拉消息整体替换（消灭前端伪造分组 id） */
  const openConversation = async (id: string): Promise<void> => {
    setActiveConversation(id)
    setMsgs([])
    try {
      const res = await request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, {
        limit: CONVERSATION_TURNS_LIMIT,
        conversationId: id,
      } satisfies ChatHistoryGetPayload)
      if (conversationRef.current !== id) return // 拉取期间用户又切走了
      setMsgs(turnsToMsgs(res.turns))
    } catch {
      // 拉不到就保持空列表，仍可继续发言（后端上下文按 id 取，不依赖 UI 展示）
    }
  }

  const sendText = (raw: string): boolean => {
    const text = raw.trim()
    if (!text) return false
    const createdAt = Date.now()
    // 发送前保证有会话 id：后端按 conversationId 取近 N 轮做上下文，绝不再隐式落 default
    let activeConversationId = conversationRef.current
    if (!activeConversationId) {
      activeConversationId = newConversationId()
      setActiveConversation(activeConversationId)
    }
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
        // 用真实 turnId 键替换 pending 占位；若极端竞态里真 msg 已由 CHUNK/REASONING 事件建过，
        // 只需删掉 pending，避免两个宠物气泡并列
        setMsgs((prev) => {
          const petKey = turnKey(res.turnId)
          const hasReal = prev.some((m) => m.key === petKey)
          if (hasReal) return prev.filter((m) => m.key !== tempPetKey)
          return prev.map((m) => (
            m.key === tempPetKey
              ? { ...m, key: petKey, conversationId: res.conversationId ?? m.conversationId, t: Date.now() }
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

  return { msgs, conversationId, conversations, listRef, sendText, startConversation, openConversation }
}

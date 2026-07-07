// §3.0 / §3.1 IPC 契约 —— 协议唯一真源，壳/harness/网关只 import 不复制

import type { TaskEvent, TaskRecord } from './task.js'
import type { StagingPlan } from './staging.js'
import type { ChatConversationSummary, ColdItem, ColdItemMeta, ColdType, Turn } from './memory.js'
import type { Config } from './config.js'

// ---------- §3.0 消息 Envelope（IPC 唯一封装） ----------

export type ErrCode =
  | 'RATE_LIMIT' | 'TIMEOUT' | 'CONTENT_FILTER' | 'UPSTREAM' | 'BAD_REQUEST' | 'UNAUTHENTICATED' // 继承 v2.1
  | 'PERMISSION_DENIED' | 'SCOPE_VIOLATION' | 'APPROVAL_TIMEOUT' | 'STAGING_APPLY_FAILED'
  | 'TASK_BUDGET_EXCEEDED' | 'SIDECAR_DOWN' | 'OS_PERMISSION_MISSING' | 'DISK_FULL'

export type EnvelopeKind = 'req' | 'res' | 'event'

export type Envelope<T = unknown> = {
  v: 1
  id: string                    // uuid；res/ack 必须回带同 id
  kind: EnvelopeKind            // req 需响应；event 单向广播
  type: string                  // §3.1 消息表
  payload: T
  error?: { code: ErrCode; message: string }   // kind='res' 失败时
  hookTrace?: string[]          // dev 模式：res/CHAT_DONE 附带（继承 v2.1）
}

// ---------- 基础类型 ----------

export type Emotion = 'happy' | 'angry' | 'sad' | 'anxious' | 'calm' | 'unknown'
export type BubbleAction = { actionId: string; label: string }   // ≤4 个
export type BubbleKind = 'reply' | 'proactive' | 'task' | 'reminder' | 'approval'
export type LoginState = 'anon' | 'logged_in'

// ---------- §3.1 消息 type 常量（全清单；M1 未用到的返回占位 res） ----------

export const IPC = {
  // 对话类
  CHAT_CONVERSATION_START: 'CHAT_CONVERSATION_START',
  CHAT_SEND: 'CHAT_SEND',
  CHAT_CHUNK: 'CHAT_CHUNK',
  // SPEC-GAP: reasoning 模型（DeepSeek R1/v4-flash）思考流独立走 CHAT_REASONING，
  // 与 CHAT_CHUNK 正文分开渲染；老 UI 收到该事件会被 dispatch 表忽略（backward-compat）
  CHAT_REASONING: 'CHAT_REASONING',
  CHAT_TOOLING: 'CHAT_TOOLING',
  CHAT_DONE: 'CHAT_DONE',
  CHAT_ERROR: 'CHAT_ERROR',
  CHAT_HISTORY_GET: 'CHAT_HISTORY_GET',
  // 宠物状态类
  PET_BUBBLE: 'PET_BUBBLE',
  PET_EMOTION_SIGNAL: 'PET_EMOTION_SIGNAL',
  BUBBLE_ACTION: 'BUBBLE_ACTION',
  PET_CLICKED: 'PET_CLICKED',
  PET_MOVED: 'PET_MOVED',
  // 任务与审批类
  TASK_EVENT: 'TASK_EVENT',
  TASK_LIST_GET: 'TASK_LIST_GET',
  TASK_CANCEL: 'TASK_CANCEL',
  PLAN_GET: 'PLAN_GET',
  APPROVAL_DECISION: 'APPROVAL_DECISION',
  UNDO_REQUEST: 'UNDO_REQUEST',
  // 提醒 / 记忆 / 配置 / 登录 / 系统类
  REMINDER_SET: 'REMINDER_SET',
  REMINDER_STOP: 'REMINDER_STOP',
  REMINDER_FIRED: 'REMINDER_FIRED',
  MEMORY_LIST_GET: 'MEMORY_LIST_GET',
  MEMORY_GET: 'MEMORY_GET',
  MEMORY_DELETE: 'MEMORY_DELETE',
  MEMORY_EDIT: 'MEMORY_EDIT',
  MEMORY_CLEAR: 'MEMORY_CLEAR',
  CONFIG_GET: 'CONFIG_GET',
  CONFIG_SET: 'CONFIG_SET',
  CONFIG_UPDATED: 'CONFIG_UPDATED',
  PERSONA_GET: 'PERSONA_GET',
  PERSONA_SET: 'PERSONA_SET',
  PERSONA_UPDATED: 'PERSONA_UPDATED',
  LOGIN_REQUEST_CODE: 'LOGIN_REQUEST_CODE',
  LOGIN_SUBMIT: 'LOGIN_SUBMIT',
  LOGOUT: 'LOGOUT',
  // BYOK：用户自带 LLM key 存 Keychain（服从 CLAUDE.md「token 只进 Keychain」硬边界），
  // 每次 chat 由 harness 携带 x-petsona-user-llm-key header，网关按请求覆盖 provider key
  LLM_KEY_GET: 'LLM_KEY_GET',
  LLM_KEY_SET: 'LLM_KEY_SET',
  LLM_KEY_CLEAR: 'LLM_KEY_CLEAR',
  LLM_DEBUG_TEST: 'LLM_DEBUG_TEST',
  AUTH_STATE_CHANGED: 'AUTH_STATE_CHANGED',
  AUTH_STATE_GET: 'AUTH_STATE_GET',
  SYS_PERMISSION_STATE: 'SYS_PERMISSION_STATE',
  SYS_IDLE_STATE: 'SYS_IDLE_STATE',
  TRACK_EVENT: 'TRACK_EVENT',
  PING: 'PING',
} as const

export type IpcType = (typeof IPC)[keyof typeof IPC]

// ---------- 各消息 payload ----------

// 对话类
export type ChatConversationStartPayload = { conversationId?: string }
export type ChatConversationStartRes = { conversationId: string }
export type ChatSendPayload = { text: string; conversationId?: string }
export type ChatSendRes = { turnId: string; conversationId: string }
export type ChatChunkPayload = { turnId: string; conversationId?: string; delta: string }
export type ChatReasoningPayload = { turnId: string; conversationId?: string; delta: string }
export type ChatToolingPayload = { turnId: string; conversationId?: string; tool: string; note: string }
export type ChatDonePayload = { turnId: string; conversationId?: string; reply: string; bubble: string }  // bubble ≤18 字
export type ChatErrorPayload = { turnId: string; conversationId?: string; code: ErrCode; petLine: string }
export type ChatHistoryGetPayload = { limit: number; conversationId?: string; includeConversations?: boolean }
export type ChatHistoryGetRes = { turns: Turn[]; conversations?: ChatConversationSummary[] }

// 宠物状态类
export type PetBubblePayload = {
  text: string
  durationMs: number
  kind: BubbleKind
  actions?: BubbleAction[]
}
export type PetEmotionSignalPayload = { state: Emotion; cause: string }
export type BubbleActionPayload = { actionId: string; value?: unknown }
export type PetPositionPayload = { position: { x: number; y: number } }

// 任务与审批类
export type TaskEventPayload = TaskEvent
export type TaskListGetRes = { tasks: TaskRecord[] }
export type TaskCancelPayload = { taskId: string }
export type PlanGetPayload = { planId: string }
export type PlanGetRes = { plan: StagingPlan }
export type ApprovalDecisionPayload = {
  planId: string
  decision: 'approve' | 'reject' | 'partial'
  excludedOpIds?: string[]
}
export type UndoFailure = { opId: string; reason: string }
export type UndoRequestPayload = { planId: string }
export type UndoRequestRes = { ok: boolean; restored: number; failed: UndoFailure[] }

// 提醒类
export type ReminderKind = 'pomodoro' | 'water' | 'stand'
export type ReminderSetPayload = { kind: ReminderKind; config?: object }
export type ReminderStopPayload = { kind: ReminderKind }
export type ReminderFiredPayload = { kind: ReminderKind; phase?: string; petLine: string }

// 记忆类
export type MemoryListGetPayload = { type?: ColdType }
export type MemoryListGetRes = { items: ColdItemMeta[] }
// SPEC-GAP: §3.1 消息表无单条记忆拉取，但 LIST 只回 gist（40 字截断），管理页编辑需要完整 body
export type MemoryGetPayload = { name: string }
export type MemoryGetRes = { item: ColdItem }
export type MemoryDeletePayload = { name: string }
export type MemoryEditPayload = { name: string; body?: string }
export type MemoryClearPayload = { scope: 'all' | ColdType }

// 配置类
export type ConfigSetPayload = { patch: Partial<Config> }
export type ConfigGetRes = { config: Config }

// 登录类（payload 结构继承 v2.1 §3.2 登录类；H 代理调网关并管 Keychain）
export type LoginRequestCodePayload = { email: string }
// 双凭证兼容：code 走老验证码路径（tests + 老客户端）；password 走桌面单步登录/注册路径
export type LoginSubmitPayload = { email: string; code?: string; password?: string }
export type AuthStateChangedPayload = { loginState: LoginState; email?: string }

// BYOK：LLM_KEY_GET 只回布尔 + 末四位掩码，永不回全量明文（防日志/截屏泄露）
export type LlmKeyGetRes = { hasKey: boolean; maskedTail?: string }
export type LlmKeySetPayload = { key: string }
export type LlmDebugTestPayload = { apiKey?: string | null }
export type LlmDebugTestRes = { ok: boolean; message: string }

// 系统类
export type SysPermissionStatePayload = {
  accessibility: boolean
  screenRecording: boolean
  automation: Record<string, boolean>
}
export type SysIdleStatePayload = { idleMinutes: number; fullscreen: boolean } // 每 60s 一次，p01/p02 输入

// 埋点
export type TrackEventPayload = { eventId: number; props: Record<string, unknown> }

// PING
export type PingRes = { ok: boolean; uptimeSec: number }

// ---------- Envelope 运行时校验（SPEC-GAP: 规格未指定校验库，手写轻量校验避免额外依赖） ----------

export function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== 'object' || x === null) return false
  const e = x as Record<string, unknown>
  return (
    e.v === 1 &&
    typeof e.id === 'string' &&
    (e.kind === 'req' || e.kind === 'res' || e.kind === 'event') &&
    typeof e.type === 'string' &&
    'payload' in e
  )
}

// §3.0 / §3.1 IPC 契约 —— 协议唯一真源，壳/harness/网关只 import 不复制

import type { TaskEvent, TaskRecord } from './task.js'
import type { StagingPlan } from './staging.js'
import type { ColdItemMeta, ColdType, Turn } from './memory.js'
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
  CHAT_SEND: 'CHAT_SEND',
  CHAT_CHUNK: 'CHAT_CHUNK',
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
export type ChatSendPayload = { text: string }
export type ChatChunkPayload = { turnId: string; delta: string }
export type ChatToolingPayload = { turnId: string; tool: string; note: string }
export type ChatDonePayload = { turnId: string; reply: string; bubble: string }  // bubble ≤18 字
export type ChatErrorPayload = { turnId: string; code: ErrCode; petLine: string }
export type ChatHistoryGetPayload = { limit: number }
export type ChatHistoryGetRes = { turns: Turn[] }

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
export type MemoryDeletePayload = { name: string }
export type MemoryEditPayload = { name: string; body?: string }
export type MemoryClearPayload = { scope: 'all' | ColdType }

// 配置类
export type ConfigSetPayload = { patch: Partial<Config> }
export type ConfigGetRes = { config: Config }

// 登录类（payload 结构继承 v2.1 §3.2 登录类；H 代理调网关并管 Keychain）
export type LoginRequestCodePayload = { email: string }
export type LoginSubmitPayload = { email: string; code: string }
export type AuthStateChangedPayload = { loginState: LoginState; email?: string }

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

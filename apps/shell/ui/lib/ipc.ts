// lib/ipc.ts —— Envelope 客户端唯一入口（§3.0/§3.1）
// 为什么集中封装：业务组件只依赖 request/send/on 三个函数；
// Tauri 桥接与浏览器 mock 总线的差异被完全隔离，脱壳调试、替换传输层都不动业务代码。

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { DEFAULT_CONFIG, IPC, isEnvelope } from '@petsona/shared'
import type { ChatSendPayload, Envelope, EnvelopeKind, ErrCode, IpcType } from '@petsona/shared'
import type { Config } from '@petsona/shared'

const REQ_TIMEOUT_MS = 15_000

export class IpcError extends Error {
  constructor(
    public readonly code: ErrCode,
    message: string,
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

// 为什么用 __TAURI_INTERNALS__ 探测：Tauri v2 注入的全局标记；
// 纯 vite 浏览器环境不存在 → 自动切到本地 mock 总线。
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}
const pending = new Map<string, Pending>()
const handlers = new Map<string, Set<(payload: unknown) => void>>()

function makeEnvelope<T>(kind: EnvelopeKind, type: string, payload: T): Envelope<T> {
  return { v: 1, id: crypto.randomUUID(), kind, type, payload }
}

// 收到一条 Envelope（真实来自 harness-envelope 事件；mock 来自本地总线）
function dispatch(env: Envelope): void {
  if (env.kind === 'res') {
    const p = pending.get(env.id)
    if (!p) return // 超时后才回来的迟到 res，静默丢弃
    pending.delete(env.id)
    clearTimeout(p.timer)
    if (env.error) p.reject(new IpcError(env.error.code, env.error.message))
    else p.resolve(env.payload)
    return
  }
  if (env.kind === 'event') {
    const hs = handlers.get(env.type)
    if (!hs || hs.size === 0) {
      // §3.0 约定：未知/无人消费的 type warn + drop，不抛错
      console.warn('[ipc] 无订阅者的 event，drop:', env.type)
      return
    }
    hs.forEach((h) => h(env.payload))
  }
}

let bridgeReady = false
function ensureBridge(): void {
  if (bridgeReady) return
  bridgeReady = true
  if (!isTauri()) return
  // e.payload 是一行 NDJSON（一个 Envelope 的 JSON 字符串）；Rust bridge 不解析业务，只转发
  void listen<string>('harness-envelope', (e) => {
    try {
      const obj: unknown = JSON.parse(e.payload)
      if (isEnvelope(obj)) dispatch(obj)
      else console.warn('[ipc] 非法 Envelope，drop')
    } catch {
      console.warn('[ipc] NDJSON 解析失败，drop')
    }
  })
}

function deliver(env: Envelope): void {
  ensureBridge()
  if (isTauri()) void invoke('ipc_send', { line: JSON.stringify(env) })
  else mockRespond(env)
}

/** kind='req'：等待同 id 的 res；error 时 reject IpcError（带 ErrCode）；15s 超时 */
export function request<T = unknown>(type: IpcType, payload: unknown = {}): Promise<T> {
  const env = makeEnvelope('req', type, payload)
  const p = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(env.id)
      reject(new IpcError('TIMEOUT', `IPC 请求超时(${REQ_TIMEOUT_MS}ms): ${type}`))
    }, REQ_TIMEOUT_MS)
    pending.set(env.id, { resolve: resolve as (v: unknown) => void, reject, timer })
  })
  deliver(env)
  return p
}

/** kind='event'：单向，不等回执 */
export function send(type: IpcType, payload: unknown = {}): void {
  deliver(makeEnvelope('event', type, payload))
}

/** 订阅 H→UI 的 event；返回退订函数 */
export function on<T = unknown>(type: IpcType, handler: (payload: T) => void): () => void {
  ensureBridge() // 为什么这里也挂桥：面板通常先订阅后发送，listener 必须尽早注册
  const h = handler as (payload: unknown) => void
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(h)
  return () => {
    set.delete(h)
  }
}

// ---------- 本地 mock 总线（仅非 Tauri 环境；方便脱离壳/harness 调 UI） ----------

const mockStartAt = Date.now()
let mockConfig: Config = DEFAULT_CONFIG
let mockPersona: Record<string, unknown> = { persona_id: 'default', customDescription: '' }
let mockLlmKeyTail: string | undefined

// 记忆管理页联调用的假数据：覆盖各分类 + settings 可编辑项（内存态，删改在会话内生效）
const mockMemories = [
  { name: 'preference-手冲咖啡', type: 'preference', topic: 'pref.coffee', source: 'chat', lastT: '2026-06-28T10:00:00Z', body: '只喝手冲，讨厌速溶咖啡' },
  { name: 'fact-养了布偶猫', type: 'fact', topic: 'life.pet', source: 'system', lastT: '2026-06-30T08:00:00Z', body: '家里养了一只布偶猫叫糯米' },
  { name: 'profile-前端工程师', type: 'profile', topic: 'work', source: 'settings', lastT: '2026-07-01T09:00:00Z', body: '职业是前端工程师，主用 React' },
  { name: 'emotion-上线焦虑', type: 'emotion', topic: 'work.release', source: 'chat', lastT: '2026-07-02T22:00:00Z', body: '每次上线前会焦虑，需要多鼓励' },
  { name: 'meme-鱼干梗', type: 'meme', topic: 'fun', source: 'chat', lastT: '2026-06-25T12:00:00Z', body: '「像鱼干一样优秀」是我们的夸人梗' },
]
const mockGist = (body: string) => (body.length > 40 ? body.slice(0, 40) + '…' : body)

function mockEmit(type: string, payload: unknown, delayMs: number): void {
  setTimeout(() => dispatch(makeEnvelope('event', type, payload)), delayMs)
}

function mockRes(env: Envelope, payload: unknown): void {
  // 回带同 id，严格模拟 §3.0 res 语义，让 request 的配对逻辑真实走一遍
  setTimeout(() => dispatch({ v: 1, id: env.id, kind: 'res', type: env.type, payload }), 30)
}

function mockRespond(env: Envelope): void {
  if (env.kind !== 'req') return // mock 下 UI→H 的单向 event（TRACK_EVENT 等）直接吞掉
  switch (env.type) {
    case IPC.PING:
      mockRes(env, { ok: true, uptimeSec: Math.floor((Date.now() - mockStartAt) / 1000) })
      return
    case IPC.CHAT_SEND: {
      const { text } = env.payload as ChatSendPayload
      const turnId = crypto.randomUUID()
      const reply = `（mock 回声）你刚才说：「${text}」。接上 harness 之后我就会真的思考啦。`
      mockRes(env, { turnId })
      mockEmit(IPC.CHAT_TOOLING, { turnId, tool: 'mock', note: '翻了翻小本本…' }, 150)
      // 为什么切 3 段：让 Chat 的按 turnId 聚合/流式渲染路径在浏览器里可调试
      const step = Math.ceil(reply.length / 3)
      for (let i = 0; i < 3; i += 1) {
        mockEmit(IPC.CHAT_CHUNK, { turnId, delta: reply.slice(i * step, (i + 1) * step) }, 400 + i * 350)
      }
      mockEmit(IPC.CHAT_DONE, { turnId, reply, bubble: reply.slice(0, 18) }, 400 + 3 * 350)
      return
    }
    case IPC.CHAT_HISTORY_GET:
      mockRes(env, { turns: [] })
      return
    case IPC.TASK_LIST_GET:
      mockRes(env, { tasks: [] })
      return
    case IPC.CONFIG_GET:
      mockRes(env, { config: mockConfig })
      return
    case IPC.CONFIG_SET: {
      const { patch } = env.payload as { patch?: Partial<Config> }
      mockConfig = {
        ...mockConfig,
        ...(patch ?? {}),
        pet: { ...mockConfig.pet, ...(patch?.pet ?? {}) },
        llmDebug: { ...mockConfig.llmDebug, ...(patch?.llmDebug ?? {}) },
        reminders: {
          ...mockConfig.reminders,
          ...(patch?.reminders ?? {}),
          pomodoro: { ...mockConfig.reminders.pomodoro, ...(patch?.reminders?.pomodoro ?? {}) },
        },
        proactive: { ...mockConfig.proactive, ...(patch?.proactive ?? {}) },
        taskBudget: { ...mockConfig.taskBudget, ...(patch?.taskBudget ?? {}) },
        scopes: patch?.scopes ?? mockConfig.scopes,
      }
      mockRes(env, { config: mockConfig })
      return
    }
    case IPC.PERSONA_GET:
      mockRes(env, { persona: mockPersona })
      return
    case IPC.PERSONA_SET: {
      const { persona } = env.payload as { persona?: Record<string, unknown> }
      mockPersona = persona ?? (env.payload as Record<string, unknown>)
      mockRes(env, { persona: mockPersona })
      return
    }
    case IPC.LLM_KEY_GET:
      mockRes(env, { hasKey: !!mockLlmKeyTail, maskedTail: mockLlmKeyTail })
      return
    case IPC.LLM_KEY_SET: {
      const { key } = env.payload as { key?: string }
      const trimmed = (key ?? '').trim()
      mockLlmKeyTail = trimmed ? trimmed.slice(-4) : undefined
      mockRes(env, { hasKey: !!mockLlmKeyTail, maskedTail: mockLlmKeyTail })
      return
    }
    case IPC.LLM_KEY_CLEAR:
      mockLlmKeyTail = undefined
      mockRes(env, { hasKey: false })
      return
    case IPC.AUTH_STATE_GET:
      mockRes(env, { loginState: 'anon' })
      return
    case IPC.LOGIN_SUBMIT: {
      const { email } = env.payload as { email: string }
      mockRes(env, {})
      mockEmit(IPC.AUTH_STATE_CHANGED, { loginState: 'logged_in', email }, 80)
      return
    }
    case IPC.LOGOUT:
      mockRes(env, {})
      mockEmit(IPC.AUTH_STATE_CHANGED, { loginState: 'anon' }, 80)
      return
    case IPC.MEMORY_LIST_GET: {
      const { type } = env.payload as { type?: string }
      const items = mockMemories
        .filter((m) => !type || m.type === type)
        .map(({ body, ...meta }) => ({ ...meta, gist: mockGist(body) }))
      mockRes(env, { items })
      return
    }
    case IPC.MEMORY_GET: {
      const { name } = env.payload as { name: string }
      mockRes(env, { item: mockMemories.find((m) => m.name === name) ?? mockMemories[0] })
      return
    }
    case IPC.MEMORY_DELETE: {
      const { name } = env.payload as { name: string }
      const i = mockMemories.findIndex((m) => m.name === name)
      if (i >= 0) mockMemories.splice(i, 1)
      mockRes(env, { ok: true })
      return
    }
    case IPC.MEMORY_EDIT: {
      const { name, body } = env.payload as { name: string; body?: string }
      const item = mockMemories.find((m) => m.name === name)
      if (item && body) item.body = body
      mockRes(env, { ok: true })
      return
    }
    case IPC.MEMORY_CLEAR: {
      const { scope } = env.payload as { scope: string }
      for (let i = mockMemories.length - 1; i >= 0; i--) {
        if (scope === 'all' || mockMemories[i]!.type === scope) mockMemories.splice(i, 1)
      }
      mockRes(env, { ok: true, cleared: 0 })
      return
    }
    default:
      // 其余 req（LOGIN_REQUEST_CODE 等）一律回空 res：mock 只求 UI 不挂死在 15s 超时
      mockRes(env, {})
  }
}

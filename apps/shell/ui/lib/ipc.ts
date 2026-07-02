// lib/ipc.ts —— Envelope 客户端唯一入口（§3.0/§3.1）
// 为什么集中封装：业务组件只依赖 request/send/on 三个函数；
// Tauri 桥接与浏览器 mock 总线的差异被完全隔离，脱壳调试、替换传输层都不动业务代码。

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { DEFAULT_CONFIG, IPC, isEnvelope } from '@petsona/shared'
import type { ChatSendPayload, Envelope, EnvelopeKind, ErrCode, IpcType } from '@petsona/shared'

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
      mockRes(env, { config: DEFAULT_CONFIG })
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
    default:
      // 其余 req（LOGIN_REQUEST_CODE 等）一律回空 res：mock 只求 UI 不挂死在 15s 超时
      mockRes(env, {})
  }
}

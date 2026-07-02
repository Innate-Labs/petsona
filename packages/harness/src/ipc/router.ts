// IPC 路由：req → handler → res；未知 type warn + drop（继承 v2.1 约定）
// M1 Gate ④：IPC 全消息表实现，未用到的注册占位 handler

import type { Envelope, ErrCode } from '@petsona/shared'
import { makeErrRes, makeRes } from './envelope.js'

export type ReqHandler = (payload: any, env: Envelope) => Promise<unknown>
export type EventHandler = (payload: any, env: Envelope) => void | Promise<void>
export type Emitter = (env: Envelope<unknown>) => void

export class IpcError extends Error {
  constructor(public code: ErrCode, message: string) {
    super(message)
  }
}

export class Router {
  private reqHandlers = new Map<string, ReqHandler>()
  private eventHandlers = new Map<string, EventHandler>()

  constructor(private emit: Emitter) {}

  onReq(type: string, handler: ReqHandler): void {
    this.reqHandlers.set(type, handler)
  }

  onEvent(type: string, handler: EventHandler): void {
    this.eventHandlers.set(type, handler)
  }

  /** M2/M3 消息占位：返回 { placeholder: true }，链路可通但无业务 */
  placeholder(type: string, milestone: 'M2' | 'M3'): void {
    this.onReq(type, async () => ({ placeholder: true, note: `${milestone} 实现` }))
  }

  async dispatch(env: Envelope): Promise<void> {
    if (env.kind === 'req') {
      const handler = this.reqHandlers.get(env.type)
      if (!handler) {
        console.error(`[ipc] 未知 req type=${env.type}，drop`)
        return
      }
      try {
        const payload = await handler(env.payload, env)
        this.emit(makeRes(env, payload))
      } catch (err) {
        if (err instanceof IpcError) {
          this.emit(makeErrRes(env, err.code, err.message))
        } else {
          this.emit(makeErrRes(env, 'BAD_REQUEST', err instanceof Error ? err.message : String(err)))
        }
      }
      return
    }
    if (env.kind === 'event') {
      const handler = this.eventHandlers.get(env.type)
      if (!handler) {
        console.error(`[ipc] 未知 event type=${env.type}，drop`)
        return
      }
      await handler(env.payload, env)
    }
    // kind='res'：harness 作为 server 不主动发 req，收到 res 直接忽略
  }
}

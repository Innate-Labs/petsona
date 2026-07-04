// §3.0 Envelope 编解码 + NDJSON 行协议

import { randomUUID } from 'node:crypto'
import type { Envelope, ErrCode } from '@petsona/shared'
import { isEnvelope } from '@petsona/shared'

export function makeReq<T>(type: string, payload: T): Envelope<T> {
  return { v: 1, id: randomUUID(), kind: 'req', type, payload }
}

export function makeRes<T>(req: Envelope, payload: T, hookTrace?: string[]): Envelope<T> {
  const res: Envelope<T> = { v: 1, id: req.id, kind: 'res', type: req.type, payload }
  if (hookTrace && process.env.PETSONA_LOG_LEVEL === 'debug') res.hookTrace = hookTrace
  return res
}

export function makeErrRes(req: Envelope, code: ErrCode, message: string): Envelope<null> {
  return { v: 1, id: req.id, kind: 'res', type: req.type, payload: null, error: { code, message } }
}

export function makeEvent<T>(type: string, payload: T): Envelope<T> {
  return { v: 1, id: randomUUID(), kind: 'event', type, payload }
}

export function encodeLine(e: Envelope<unknown>): string {
  return JSON.stringify(e) + '\n'
}

export function decodeLine(line: string): Envelope | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return isEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

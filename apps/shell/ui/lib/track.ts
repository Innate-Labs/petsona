// lib/track.ts —— 埋点统一出口（§9）
// 为什么只发不存：UI 只负责把事件丢进 TRACK_EVENT 单向通道，
// 缓冲、批量、DeviceID/UserID 补全与上报全部由 harness 承担，UI 不重复实现。

import { IPC } from '@petsona/shared'
import type { TrackEventPayload } from '@petsona/shared'
import { send } from './ipc'

export function track(eventId: number, props: Record<string, unknown> = {}): void {
  const payload: TrackEventPayload = { eventId, props }
  send(IPC.TRACK_EVENT, payload)
}

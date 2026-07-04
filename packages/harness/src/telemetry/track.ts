// §9 埋点 SDK：缓冲 + 批量上报（不采正文，域名级脱敏——继承 v2.1 框架）
// 上报只经 gateway/client.ts（缝①）

import type { TrackEvent } from '@petsona/shared'
import { TRACK_BATCH_SIZE, TRACK_FLUSH_MS } from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'

export class Tracker {
  private buffer: TrackEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private gateway: GatewayClient,
    private deviceId: string,
    private getUserId: () => string | undefined,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.flush(), TRACK_FLUSH_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  track(eventId: number, props: Record<string, unknown> = {}): void {
    this.buffer.push({ eventId, props, t: Date.now(), deviceId: this.deviceId, userId: this.getUserId() })
    if (this.buffer.length >= TRACK_BATCH_SIZE) void this.flush()
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const batch = this.buffer.splice(0, this.buffer.length)
    try {
      await this.gateway.trackBatch(batch)
    } catch {
      // 上报失败不阻塞业务；放回缓冲（上限 200 条防积压爆内存）
      this.buffer = [...batch, ...this.buffer].slice(0, 200)
    }
  }
}

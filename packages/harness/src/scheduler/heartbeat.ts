// p01 心跳 + p02 硬校验（§3.8）：SYS_IDLE_STATE（壳每 60s）驱动。
// 决策调用（cheap LLM）通过 deps.decide 注入——scheduler/ 不 import gateway（结构测试强制）。
// 双重 p02：决策前一次、发气泡前再一次（决策调用耗时数秒，期间状态可能已变化，§3.8「消费时二次校验」）。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Config, ProactiveFrequency, SysIdleStatePayload } from '@petsona/shared'
import { PROACTIVE_MIN_GAP } from '@petsona/shared'
import { p02Gate } from './guards.js'

// SPEC-GAP: 模型返回 skip 后的再询问间隔规格未定；60s 心跳裸询问会打爆 cheap 档，取 5min
export const DECISION_RETRY_MS = 5 * 60_000

type HeartbeatState = { lastProactiveAt: number; recent: string[] }

export type HeartbeatDeps = {
  getConfig: () => Config
  decide: (input: { idleMinutes: number; frequency: Exclude<ProactiveFrequency, 'off'> }) => Promise<string | null>
  isDuplicate: (text: string, recent: string[]) => Promise<boolean>
  emitProactive: (text: string) => void
  statePath: string
  now?: () => number
}

export class Heartbeat {
  private state: HeartbeatState
  private lastDecisionAt = 0
  private inFlight = false
  private latestFullscreen = false
  private readonly now: () => number

  constructor(private deps: HeartbeatDeps) {
    this.now = deps.now ?? Date.now
    this.state = this.load()
  }

  async onIdle(p: SysIdleStatePayload): Promise<void> {
    this.latestFullscreen = !!p.fullscreen   // 先记录，供在途决策的二次校验用
    if (this.inFlight) return
    const cfg = this.deps.getConfig().proactive
    if (cfg.frequency === 'off') return
    const now = this.now()
    // SPEC-GAP: 空闲阈值规格未单列，取频次档最小间隔（架构 §4.1「阈值由主动说话频次决定」）
    if (p.idleMinutes < PROACTIVE_MIN_GAP[cfg.frequency]) return
    if (now - this.lastDecisionAt < DECISION_RETRY_MS) return
    if (p02Gate({ ...cfg, fullscreen: p.fullscreen, lastProactiveAt: this.state.lastProactiveAt, now }) !== 'ok') return

    this.inFlight = true
    this.lastDecisionAt = now
    try {
      const text = await this.deps.decide({ idleMinutes: p.idleMinutes, frequency: cfg.frequency })
      if (!text) return
      if (await this.deps.isDuplicate(text, this.state.recent)) return
      const cfg2 = this.deps.getConfig().proactive
      if (cfg2.frequency === 'off') return
      if (p02Gate({ ...cfg2, fullscreen: this.latestFullscreen, lastProactiveAt: this.state.lastProactiveAt, now: this.now() }) !== 'ok') return
      this.deps.emitProactive(text)
      this.state = { lastProactiveAt: this.now(), recent: [...this.state.recent, text].slice(-3) }
      this.save()
    } finally {
      this.inFlight = false
    }
  }

  private load(): HeartbeatState {
    if (existsSync(this.deps.statePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.deps.statePath, 'utf8'))
        return {
          lastProactiveAt: typeof parsed.lastProactiveAt === 'number' ? parsed.lastProactiveAt : 0,
          recent: Array.isArray(parsed.recent) ? parsed.recent.filter((x: unknown) => typeof x === 'string').slice(-3) : [],
        }
      } catch { /* 损坏当空 */ }
    }
    return { lastProactiveAt: 0, recent: [] }
  }

  private save(): void {
    try {
      writeFileSync(this.deps.statePath, JSON.stringify(this.state, null, 2))
    } catch (err) {
      console.error('[heartbeat] proactive.json 落盘失败:', err)
    }
  }
}

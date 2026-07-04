// pet/EmotionMachine.ts —— 情绪状态机 p04（§4 情绪 sprite 行）
// 为什么是纯 TS 类不碰 React：便于 vitest 直接单测（可注入 now/dwellMs），
// 也让「是否切 sprite」的裁决逻辑独立于渲染层，PetWindow 只做订阅展示。

import type { Emotion } from '@petsona/shared'

export const EMOTION_DWELL_MS = 90_000 // 规则①：每个情绪驻留 ≥90s

type Listener = (state: Emotion) => void

export class EmotionMachine {
  private state: Emotion = 'calm' // 启动默认待机情绪
  private pending: Emotion | null = null
  private lastCause = ''
  // 为什么初始 -Infinity：启动时的 calm 不是真实情绪结论，
  // 首个信号应立即生效，不该白吃一次 90s 驻留。
  private lastSwitchAt = Number.NEGATIVE_INFINITY
  private turnQuota = 1 // 规则②：每轮对话 ≤1 次切换；markTurn() 重置额度
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly dwellMs: number
  private readonly now: () => number

  constructor(opts: { dwellMs?: number; now?: () => number } = {}) {
    this.dwellMs = opts.dwellMs ?? EMOTION_DWELL_MS
    this.now = opts.now ?? Date.now
  }

  /** 输入：PET_EMOTION_SIGNAL 事件或本地兜底信号 */
  signal(state: Emotion, cause: string): void {
    this.lastCause = cause
    // 驻留期内信号只暂存最新一条：与当前态相同 → 最新意图就是维持现状，清空排队
    this.pending = state === this.state ? null : state
    this.tryApply()
  }

  /** 一轮对话结束（CHAT_DONE / CHAT_ERROR）时调用：恢复本轮唯一切换额度 */
  markTurn(): void {
    this.turnQuota = 1
    this.tryApply()
  }

  getState(): Emotion {
    return this.state
  }

  getLastCause(): string {
    return this.lastCause
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.listeners.clear()
  }

  private tryApply(): void {
    if (this.pending === null || this.turnQuota <= 0) return // 无待切/额度用尽 → 等 markTurn
    const wait = this.lastSwitchAt + this.dwellMs - this.now()
    if (wait > 0) {
      // 驻留未满：定时到点重试；期间新 signal 会覆盖 pending（即「驻留期满取最新」）
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        this.tryApply()
      }, wait)
      return
    }
    this.state = this.pending
    this.pending = null
    this.lastSwitchAt = this.now()
    this.turnQuota -= 1
    this.listeners.forEach((fn) => fn(this.state))
  }
}

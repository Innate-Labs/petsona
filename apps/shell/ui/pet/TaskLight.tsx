// pet/TaskLight.tsx —— 桌宠头顶任务状态灯：💡黄=执行中 / 绿=成功 / 红=失败 + 小字提示
// 为什么在宠物侧展示详情：聊天框只留「任务执行中」动画（不刷屏），进度/结果的追踪入口收敛到桌宠头顶。
// 数据源是 harness TaskBoard 广播的 TASK_EVENT（created/progress/awaiting_approval/result），不按会话过滤——
// 用户切了会话也能看到任务动静（此前任务反馈只走 CHAT_DONE，换会话就"失踪"，这是任务进度无法追踪的主因之一）。

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { TaskEvent } from '@petsona/shared'
import { on } from '../lib/ipc'

export type TaskLightPhase = 'running' | 'done' | 'failed'
export type TaskLightState = { taskId: string; phase: TaskLightPhase; note: string; updatedAt: number }

// 终态灯驻留时长（失败带原因摘要，多留几秒）；running 无终态事件时的兜底寿命（taskBudget wallclock 10min + 余量）
const DONE_VISIBLE_MS = 6000
const FAILED_VISIBLE_MS = 9000
const RUNNING_STALE_MS = 15 * 60_000
const NOTE_MAX = 18
// 终态小字比进行中多留一点空间：状态词 + 结果摘要
const RESULT_NOTE_MAX = 26

function resultNote(event: Extract<TaskEvent, { t: 'result' }>): { phase: TaskLightPhase; note: string } {
  const label = event.status === 'completed' ? { phase: 'done' as const, word: '任务完成' }
    : event.status === 'cancelled' ? { phase: 'failed' as const, word: '任务已取消' }
    : event.status === 'rejected' ? { phase: 'failed' as const, word: '任务已拒绝' }
    : event.status === 'timeout' ? { phase: 'failed' as const, word: '任务超时' }
    : { phase: 'failed' as const, word: '任务失败' }
  // 摘要优先取做了什么，失败侧取没做成的原因
  const summary = (event.status === 'completed'
    ? event.result?.didWhat?.find(Boolean)
    : event.result?.leftover?.find(Boolean) || event.result?.didWhat?.find(Boolean)) ?? ''
  const note = summary ? `${label.word}：${summary}` : label.word
  return { phase: label.phase, note: note.slice(0, RESULT_NOTE_MAX) }
}

export function useTaskLight(): TaskLightState | null {
  const [lights, setLights] = useState<Map<string, TaskLightState>>(() => new Map())
  const [, setTick] = useState(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const off = on<TaskEvent>(IPC.TASK_EVENT, (event) => {
      setLights((prev) => {
        const next = new Map(prev)
        const updatedAt = Date.now()
        if (event.t === 'created') {
          next.set(event.taskId, { taskId: event.taskId, phase: 'running', note: event.goal.slice(0, NOTE_MAX), updatedAt })
        } else if (event.t === 'progress') {
          next.set(event.taskId, { taskId: event.taskId, phase: 'running', note: event.note.slice(0, NOTE_MAX), updatedAt })
        } else if (event.t === 'awaiting_approval') {
          next.set(event.taskId, { taskId: event.taskId, phase: 'running', note: '等待你的确认', updatedAt })
        } else if (event.t === 'result') {
          const { phase, note } = resultNote(event)
          next.set(event.taskId, { taskId: event.taskId, phase, note, updatedAt })
        }
        return next
      })
      if (event.t === 'result') {
        // 终态灯亮一会儿自动撤下；若还有别的 running 任务，撤下后自然回落显示它
        const timer = setTimeout(() => {
          setLights((prev) => {
            const next = new Map(prev)
            next.delete(event.taskId)
            return next
          })
        }, event.status === 'completed' ? DONE_VISIBLE_MS : FAILED_VISIBLE_MS)
        timers.add(timer)
      }
    })
    // 兜底 tick：harness 崩溃丢终态事件时，stale 的 running 灯靠周期重算隐藏
    const tick = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => {
      off()
      clearInterval(tick)
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const now = Date.now()
  let latest: TaskLightState | null = null
  for (const state of lights.values()) {
    if (state.phase === 'running' && now - state.updatedAt > RUNNING_STALE_MS) continue
    if (!latest || state.updatedAt > latest.updatedAt) latest = state
  }
  return latest
}

export function TaskLight({ state }: { state: TaskLightState }) {
  return (
    <div className={`pet-task-light ${state.phase}`} role="status" aria-live="polite">
      <svg className="pet-task-light-bulb" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {/* 灯泡：圆罩 + 灯座；fill 跟 currentColor，颜色由 phase class 决定 */}
        <path d="M8 1.2a4.6 4.6 0 0 1 2.6 8.4c-.5.36-.8.9-.8 1.5v.2H6.2v-.2c0-.6-.3-1.14-.8-1.5A4.6 4.6 0 0 1 8 1.2z" fill="currentColor" />
        <rect x="6.2" y="12.2" width="3.6" height="1.1" rx="0.55" fill="currentColor" opacity="0.75" />
        <rect x="6.7" y="13.7" width="2.6" height="1" rx="0.5" fill="currentColor" opacity="0.5" />
      </svg>
      <span className="pet-task-light-note">{state.note}</span>
    </div>
  )
}

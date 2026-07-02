// §3.3 任务派发协议（dispatch_task · 双循环之间的唯一通道）

// —— 派发（陪伴循环 → 任务板）——
export type AgentType = 'explore' | 'worker'   // explore=只读工具；worker=读写全开

export type DispatchRequest = {
  goal: string                        // 模型写的任务简报（自然语言，含成功标准）
  agentType: AgentType
  scope: { dirs: string[]; net: boolean }   // dirs 必须 ⊆ Config.scopes，否则 SCOPE_VIOLATION
  skill?: string                      // 命中技能名（可空，子 Agent 内亦可 load_skill）
}

export type TaskStatus =
  | 'queued' | 'running' | 'awaiting_approval' | 'applying'
  | 'completed' | 'failed' | 'rejected' | 'cancelled' | 'timeout'

// —— 任务记录（$DATA/tasks/task_<id>.json，s12 简化版）——
export type TaskRecord = {
  id: string                          // task_<epoch>_<rand4>
  goal: string
  agentType: AgentType
  scope: DispatchRequest['scope']
  status: TaskStatus
  planId?: string                     // worker 型产生 staging 计划后回填
  createdAt: number
  endedAt?: number
  usage: { toolCalls: number; tokens: number }
  result?: TaskResult
}

// —— 结果（子 Agent 最终输出，schema 强制；是给主 Agent 的数据，不是给用户的话）——
export type TaskResult = {
  ok: boolean
  didWhat: string[]                   // 事实性动作列表
  changes: { op: string; path: string }[]   // 与 undo 日志一致
  findings?: string[]                 // explore 型的发现
  leftover: string[]                  // 没做/做不了 + 原因（含 scope 外需求）
  stats: { files?: number; bytes?: number; durationSec: number }
}

// —— 事件（H→UI 的 TASK_EVENT.payload；同时进陪伴循环注入队列）——
import type { PlanDigest } from './staging.js'

export type TaskEvent =
  | { t: 'created'; taskId: string; goal: string }
  | { t: 'progress'; taskId: string; note: string }            // report_progress / todo 镜像，≤30 字
  | { t: 'awaiting_approval'; taskId: string; planId: string; digest: PlanDigest }
  | { t: 'result'; taskId: string; status: TaskStatus; result?: TaskResult }

// 并发上限：worker×1 + explore×1，超出排队（queued）；子 Agent 内禁止再 dispatch
export const TASK_CONCURRENCY = { worker: 1, explore: 1 } as const

import { randomUUID } from 'node:crypto'
import { IPC, type TaskRecord, type TaskStatus } from '@petsona/shared'
import type { SessionsDb } from '../memory/sqlite.js'
import type { PostLLMDraft } from '../hooks/pipeline.js'

type FeedbackDeps = {
  db: SessionsDb
  conversationId?: string
  emit: (event: { type: string; payload: unknown }) => void
  runPostLLM: (draft: PostLLMDraft) => Promise<PostLLMDraft>
}

type TaskStats = NonNullable<TaskRecord['result']>['stats']

const STATUS_LABEL: Partial<Record<TaskStatus, string>> = {
  completed: '完成',
  failed: '失败',
  rejected: '已拒绝',
  cancelled: '已取消',
  timeout: '超时',
}

export async function publishTaskFeedback(task: TaskRecord, deps: FeedbackDeps): Promise<void> {
  const text = buildTaskFeedbackText(task)
  const draft = await deps.runPostLLM({ text, loop: 'companion' })
  const conversationId = task.conversationId || deps.conversationId || 'default'
  const t = Date.now()
  deps.db.insertTurn('pet', draft.text, t, { conversationId })
  const turnId = `task_${task.id}_${randomUUID().slice(0, 8)}`
  const bubble = draft.bubble ?? buildTaskFeedbackBubble(task)
  deps.emit({
    type: IPC.PET_BUBBLE,
    payload: { text: bubble, durationMs: 10_000, kind: 'task' },
  })
  deps.emit({
    type: IPC.CHAT_DONE,
    payload: { turnId, conversationId, reply: draft.text, bubble },
  })
}

export function buildTaskFeedbackText(task: TaskRecord): string {
  const status = STATUS_LABEL[task.status] ?? task.status
  const did = task.result?.didWhat?.filter(Boolean) ?? []
  const findings = task.result?.findings?.filter(Boolean) ?? []
  const changes = task.result?.changes?.filter((change) => change.path) ?? []
  const leftover = task.result?.leftover?.filter(Boolean) ?? []
  const summary = (did[0] || findings[0] || leftover[0] || task.goal).trim()
  const lines = [`任务${status}：${summary}`]

  pushSection(lines, '已完成', did)
  pushSection(lines, '结果', findings)
  pushSection(lines, '改动', changes.map((change) => `${change.op} ${change.path}`))
  pushSection(lines, '未完成', leftover)

  const stats = formatStats(task.result?.stats)
  if (stats) lines.push(`统计：${stats}`)

  return lines.join('\n')
}

export function buildTaskFeedbackBubble(task: TaskRecord): string {
  const status = STATUS_LABEL[task.status] ?? task.status
  const result = task.result
  const summary = result?.didWhat?.find(Boolean)
    || result?.findings?.find(Boolean)
    || result?.leftover?.find(Boolean)
    || task.goal
  return `任务${status}：${summary}`.slice(0, 60)
}

function pushSection(lines: string[], title: string, items: string[]): void {
  if (!items.length) return
  lines.push(`${title}：`)
  for (const item of items.slice(0, 8)) lines.push(`- ${item}`)
}

function formatStats(stats: TaskStats | undefined): string {
  if (!stats) return ''
  const parts: string[] = []
  if (typeof stats.files === 'number') parts.push(`${stats.files} 个文件`)
  if (typeof stats.bytes === 'number') parts.push(`${stats.bytes} 字节`)
  if (typeof stats.durationSec === 'number') parts.push(`${stats.durationSec} 秒`)
  return parts.join('，')
}

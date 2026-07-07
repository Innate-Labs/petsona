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
  deps.emit({
    type: IPC.PET_BUBBLE,
    payload: { text: draft.text, durationMs: 10_000, kind: 'task' },
  })
  deps.emit({
    type: IPC.CHAT_DONE,
    payload: { turnId, conversationId, reply: draft.text, bubble: draft.bubble ?? draft.text.slice(0, 18) },
  })
}

export function buildTaskFeedbackText(task: TaskRecord): string {
  const status = STATUS_LABEL[task.status] ?? task.status
  const did = task.result?.didWhat?.filter(Boolean) ?? []
  const leftover = task.result?.leftover?.filter(Boolean) ?? []
  const facts = did.length ? did : leftover.length ? leftover : [task.goal]
  const summary = facts.slice(0, 3).join('；')
  return `任务${status}：${summary}`
}

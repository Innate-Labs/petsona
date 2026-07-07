import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC, type TaskRecord } from '@petsona/shared'
import { SessionsDb } from '../../packages/harness/src/memory/sqlite.js'
import { publishTaskFeedback } from '../../packages/harness/src/tasks/feedback.js'

const baseTask = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task_feedback_1',
  goal: '整理测试文件',
  agentType: 'worker',
  scope: { dirs: ['~/Downloads'], net: false },
  status: 'completed',
  createdAt: 1000,
  endedAt: 2000,
  usage: { toolCalls: 1, tokens: 10 },
  result: {
    ok: true,
    didWhat: ['已整理 3 个文件'],
    changes: [{ op: 'move', path: '~/Downloads/a.txt' }],
    leftover: [],
    stats: { files: 3, durationSec: 2 },
  },
  ...patch,
})

describe('task result feedback', () => {
  it('publishes terminal task result to both pet bubble and chat history', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-task-feedback-')), 'sessions.db'))
    const emitted: Array<{ type: string; payload: any }> = []

    await publishTaskFeedback(baseTask({ conversationId: 'conv-task' }), {
      db,
      emit: (event) => emitted.push(event),
      runPostLLM: async ({ text }) => ({ text, bubble: text.slice(0, 18), loop: 'companion' }),
    })

    const bubble = emitted.find((event) => event.type === IPC.PET_BUBBLE)
    const done = emitted.find((event) => event.type === IPC.CHAT_DONE)
    const turns = db.recentTurnsByConversation('conv-task', 10)

    expect(bubble?.payload.kind).toBe('task')
    expect(bubble?.payload.text).toContain('已整理 3 个文件')
    expect(done?.payload.conversationId).toBe('conv-task')
    expect(done?.payload.reply).toContain('已整理 3 个文件')
    expect(turns.at(-1)?.role).toBe('pet')
    expect(turns.at(-1)?.text).toContain('已整理 3 个文件')
    db.close()
  })

  it('includes failure status and leftover reason in task feedback', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-task-feedback-fail-')), 'sessions.db'))
    const emitted: Array<{ type: string; payload: any }> = []

    await publishTaskFeedback(baseTask({
      status: 'failed',
      result: {
        ok: false,
        didWhat: [],
        changes: [],
        leftover: ['路径超出授权范围'],
        stats: { durationSec: 1 },
      },
    }), {
      db,
      conversationId: 'conv-fallback',
      emit: (event) => emitted.push(event),
      runPostLLM: async ({ text }) => ({ text, bubble: text.slice(0, 18), loop: 'companion' }),
    })

    const bubble = emitted.find((event) => event.type === IPC.PET_BUBBLE)
    const done = emitted.find((event) => event.type === IPC.CHAT_DONE)

    expect(bubble?.payload.text).toContain('失败')
    expect(bubble?.payload.text).toContain('路径超出授权范围')
    expect(done?.payload.conversationId).toBe('conv-fallback')
    expect(done?.payload.reply).toContain('路径超出授权范围')
    db.close()
  })

  it('keeps detailed findings, changed paths, and stats in chat while using a compact bubble', async () => {
    const db = new SessionsDb(join(mkdtempSync(join(tmpdir(), 'petsona-task-feedback-detail-')), 'sessions.db'))
    const emitted: Array<{ type: string; payload: any }> = []

    await publishTaskFeedback(baseTask({
      agentType: 'explore',
      result: {
        ok: true,
        didWhat: ['已完成配置排查'],
        changes: [
          { op: 'write', path: '/tmp/petsona/report.md' },
          { op: 'move', path: '/tmp/petsona/archive/a.txt' },
        ],
        findings: ['真实结果：入口文件缺少结果摘要渲染', '建议：将 findings 写入对话历史'],
        leftover: ['未修改登录流程，因为不在本次范围'],
        stats: { files: 2, bytes: 4096, durationSec: 12 },
      },
    }), {
      db,
      conversationId: 'conv-detail',
      emit: (event) => emitted.push(event),
      runPostLLM: async ({ text }) => ({ text, bubble: '任务完成：已完成配置排查', loop: 'companion' }),
    })

    const bubble = emitted.find((event) => event.type === IPC.PET_BUBBLE)
    const done = emitted.find((event) => event.type === IPC.CHAT_DONE)
    const turns = db.recentTurnsByConversation('conv-detail', 10)

    expect(bubble?.payload.text).toBe('任务完成：已完成配置排查')
    expect(done?.payload.reply).toContain('真实结果：入口文件缺少结果摘要渲染')
    expect(done?.payload.reply).toContain('/tmp/petsona/report.md')
    expect(done?.payload.reply).toContain('2 个文件')
    expect(done?.payload.reply).toContain('4096 字节')
    expect(turns.at(-1)?.text).toContain('建议：将 findings 写入对话历史')
    db.close()
  })
})

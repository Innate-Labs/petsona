// M2 任务板：落盘、并发、事件、取消

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, IPC } from '@petsona/shared'
import type { TaskRecord, TaskResult } from '@petsona/shared'
import { TaskBoard, TaskBoardError, type TaskExecutor } from '../../packages/harness/src/tasks/board.js'

const okResult = (label: string): TaskResult => ({
  ok: true,
  didWhat: [label],
  changes: [],
  leftover: [],
  stats: { durationSec: 0 },
})

function makeBoard(executor?: TaskExecutor) {
  const events: { type: string; payload: any }[] = []
  const injected: TaskRecord[] = []
  const tasksDir = mkdtempSync(join(tmpdir(), 'petsona-task-board-'))
  const board = new TaskBoard({
    tasksDir,
    getConfig: () => DEFAULT_CONFIG,
    emit: (e) => events.push(e),
    enqueueResult: (task) => injected.push(task),
    executor,
  })
  return { board, events, injected, tasksDir }
}

async function eventually(fn: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      fn()
      return
    } catch (err) {
      last = err
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw last
}

describe('TaskBoard', () => {
  it('dispatch_task 创建任务记录、广播 TASK_EVENT 并完成占位执行', async () => {
    const { board, events, injected, tasksDir } = makeBoard()
    const out = board.dispatch({
      goal: '整理下载文件夹',
      agentType: 'worker',
      scope: { dirs: ['~/Downloads'], net: false },
    })

    expect(out.taskId).toMatch(/^task_/)
    expect(board.get(out.taskId)?.status).toBe('running')
    expect(events.some((e) => e.type === IPC.TASK_EVENT && e.payload.t === 'created')).toBe(true)

    await eventually(() => expect(board.get(out.taskId)?.status).toBe('completed'))
    const rec = board.get(out.taskId)!
    expect(rec.result?.didWhat).toContain('已创建任务记录')
    expect(readFileSync(join(tasksDir, `${out.taskId}.json`), 'utf8')).toContain('整理下载文件夹')
    expect(injected[0]?.id).toBe(out.taskId)
  })

  it('worker 并发为 1：第二个 worker 排队，取消 queued 任务', async () => {
    const releases: ((v: TaskResult) => void)[] = []
    const executor: TaskExecutor = async () => new Promise((resolve) => releases.push(resolve))
    const { board } = makeBoard(executor)

    const first = board.dispatch({ goal: '任务一', agentType: 'worker', scope: { dirs: ['~/Downloads'], net: false } })
    const second = board.dispatch({ goal: '任务二', agentType: 'worker', scope: { dirs: ['~/Downloads'], net: false } })

    expect(board.get(first.taskId)?.status).toBe('running')
    expect(board.get(second.taskId)?.status).toBe('queued')

    const cancelled = board.cancel(second.taskId)
    expect(cancelled.task?.status).toBe('cancelled')
    releases[0]!(okResult('done'))

    await eventually(() => expect(board.get(first.taskId)?.status).toBe('completed'))
    expect(board.get(second.taskId)?.status).toBe('cancelled')
  })

  it('取消 running 任务会落盘 cancelled 并发 result 事件', async () => {
    const executor: TaskExecutor = async (_task, ctx) => new Promise((resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      setTimeout(() => resolve(okResult('too late')), 1000)
    })
    const { board, events } = makeBoard(executor)
    const task = board.dispatch({ goal: '长任务', agentType: 'worker', scope: { dirs: ['~/Downloads'], net: false } })

    expect(board.cancel(task.taskId).task?.status).toBe('cancelled')
    await eventually(() => {
      const resultEvents = events.filter((e) => e.payload?.t === 'result' && e.payload.taskId === task.taskId)
      expect(resultEvents.at(-1)?.payload.status).toBe('cancelled')
    })
    expect(board.get(task.taskId)?.status).toBe('cancelled')
  })

  it('scope 超出 Config.scopes 时拒绝派发', () => {
    const { board } = makeBoard()
    expect(() =>
      board.dispatch({ goal: '动系统目录', agentType: 'worker', scope: { dirs: ['/etc'], net: false } }),
    ).toThrowError(TaskBoardError)
  })
})

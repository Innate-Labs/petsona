import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, IPC, type PlanDigest, type TaskResult } from '@petsona/shared'
import { resolvePaths } from '../../packages/harness/src/paths.js'
import { StagingStore } from '../../packages/harness/src/staging/store.js'
import { TaskAwaitingApproval, TaskBoard, type TaskExecutor } from '../../packages/harness/src/tasks/board.js'

function tempPaths() {
  process.env.PETSONA_DATA_DIR = mkdtempSync(join(tmpdir(), 'petsona-staging-'))
  return resolvePaths('test-user')
}

describe('StagingStore', () => {
  it('write 操作先 staging，apply 后写真实文件，undo 恢复旧内容', () => {
    const paths = tempPaths()
    const store = new StagingStore(paths)
    const target = join(paths.root, 'note.txt')
    writeFileSync(target, 'old')

    store.stageWrite('task_1', target, 'new')
    expect(readFileSync(target, 'utf8')).toBe('old')

    const plan = store.createPlan('task_1')
    expect(plan.digest.counts.write).toBe(1)
    const applied = store.apply(plan.planId)
    expect(applied.failed).toEqual([])
    expect(readFileSync(target, 'utf8')).toBe('new')

    const undone = store.undo(plan.planId)
    expect(undone.ok).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('old')
  })

  it('trash 操作 apply 后移走文件，undo 可恢复', () => {
    const paths = tempPaths()
    const store = new StagingStore(paths)
    const target = join(paths.root, 'trash-me.txt')
    writeFileSync(target, 'bye')

    store.stageTrash('task_2', target)
    expect(existsSync(target)).toBe(true)
    const plan = store.createPlan('task_2')
    expect(plan.digest.risk).toBe('L2')

    expect(store.apply(plan.planId).failed).toEqual([])
    expect(existsSync(target)).toBe(false)
    expect(store.undo(plan.planId).ok).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('bye')
  })
})

describe('TaskBoard approval state', () => {
  it('executor 抛 TaskAwaitingApproval 时进入 awaiting_approval 并广播事件', async () => {
    const paths = tempPaths()
    const digest: PlanDigest = {
      counts: { write: 1, mkdir: 0, move: 0, rename: 0, trash: 0 },
      byDir: [],
      samples: ['写入 note.txt'],
      risk: 'L1',
    }
    const partial: TaskResult = {
      ok: true,
      didWhat: ['生成计划'],
      changes: [],
      leftover: ['等待审批'],
      stats: { durationSec: 0 },
    }
    const executor: TaskExecutor = async () => {
      throw new TaskAwaitingApproval('plan_test', digest, partial)
    }
    const events: { type: string; payload: any }[] = []
    const board = new TaskBoard({
      tasksDir: paths.tasksDir,
      getConfig: () => DEFAULT_CONFIG,
      emit: (e) => events.push(e),
      executor,
    })

    const task = board.dispatch({ goal: '改文件', agentType: 'worker', scope: { dirs: ['~/Downloads'], net: false } })
    await eventually(() => expect(board.get(task.taskId)?.status).toBe('awaiting_approval'))
    expect(board.get(task.taskId)?.planId).toBe('plan_test')
    expect(events.some((e) => e.type === IPC.TASK_EVENT && e.payload.t === 'awaiting_approval')).toBe(true)

    board.rejectApproval(task.taskId)
    expect(board.get(task.taskId)?.status).toBe('rejected')
  })
})

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

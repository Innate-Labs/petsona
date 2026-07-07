// s12 简化任务板：$DATA/tasks 落盘 + 状态机 + 1 worker / 1 explore 并发

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { Config, DispatchRequest, ErrCode, PlanDigest, TaskEvent, TaskRecord, TaskResult, TaskStatus } from '@petsona/shared'
import { IPC, TASK_CONCURRENCY } from '@petsona/shared'

const TERMINAL: readonly TaskStatus[] = ['completed', 'failed', 'rejected', 'cancelled', 'timeout']

type AgentType = DispatchRequest['agentType']

export class TaskBoardError extends Error {
  constructor(public readonly code: ErrCode, message: string) {
    super(message)
  }
}

export class TaskAwaitingApproval extends Error {
  constructor(
    public readonly planId: string,
    public readonly digest: PlanDigest,
    public readonly result?: TaskResult,
  ) {
    super('任务等待审批')
  }
}

export type TaskExecutorContext = {
  signal: AbortSignal
  progress: (note: string) => void
  usage: (delta: Partial<TaskRecord['usage']>) => void
}

export type TaskExecutor = (task: TaskRecord, ctx: TaskExecutorContext) => Promise<TaskResult>

export type TaskBoardDeps = {
  tasksDir: string
  getConfig: () => Config
  emit: (event: { type: string; payload: unknown }) => void
  enqueueResult?: (task: TaskRecord) => void
  onDispatch?: (task: TaskRecord) => void
  onAwaitingApproval?: (task: TaskRecord, digest: PlanDigest) => void
  onResult?: (task: TaskRecord) => void
  executor?: TaskExecutor
}

export class TaskBoard {
  private waiting: Record<AgentType, string[]> = { worker: [], explore: [] }
  private running: Record<AgentType, string | null> = { worker: null, explore: null }
  private aborters = new Map<string, AbortController>()
  private executor: TaskExecutor

  constructor(private deps: TaskBoardDeps) {
    mkdirSync(deps.tasksDir, { recursive: true })
    this.executor = deps.executor ?? defaultExecutor
  }

  dispatch(input: DispatchRequest, fromTaskId?: string, conversationId?: string): { taskId: string; status: TaskStatus } {
    if (fromTaskId) throw new TaskBoardError('BAD_REQUEST', '子 Agent 内禁止再 dispatch')
    const req = validateDispatch(input, this.deps.getConfig())
    const task: TaskRecord = {
      id: makeTaskId(),
      goal: req.goal,
      agentType: req.agentType,
      scope: req.scope,
      conversationId,
      status: 'queued',
      createdAt: Date.now(),
      usage: { toolCalls: 0, tokens: 0 },
    }
    if (req.skill) task.skill = req.skill
    this.write(task)
    this.waiting[task.agentType].push(task.id)
    this.publish({ t: 'created', taskId: task.id, goal: task.goal })
    this.deps.onDispatch?.(task)
    this.pump(task.agentType)
    return { taskId: task.id, status: task.status }
  }

  list(): TaskRecord[] {
    return readdirSync(this.deps.tasksDir)
      .filter((name) => /^task_.+\.json$/.test(name))
      .map((name) => this.safeRead(join(this.deps.tasksDir, name)))
      .filter((x): x is TaskRecord => !!x)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  get(taskId: string): TaskRecord | null {
    if (!isSafeTaskId(taskId)) return null
    return this.safeRead(this.pathFor(taskId))
  }

  cancel(taskId: string): { ok: boolean; task?: TaskRecord } {
    const task = this.get(taskId)
    if (!task) throw new TaskBoardError('BAD_REQUEST', '任务不存在')
    if (TERMINAL.includes(task.status)) return { ok: false, task }

    this.waiting[task.agentType] = this.waiting[task.agentType].filter((id) => id !== task.id)
    this.aborters.get(task.id)?.abort()
    const cancelled: TaskRecord = { ...task, status: 'cancelled', endedAt: Date.now() }
    this.write(cancelled)
    this.publish({ t: 'result', taskId: cancelled.id, status: 'cancelled', result: cancelled.result })
    this.deps.enqueueResult?.(cancelled)
    this.deps.onResult?.(cancelled)
    return { ok: true, task: cancelled }
  }

  markApplying(taskId: string): TaskRecord {
    const task = this.get(taskId)
    if (!task) throw new TaskBoardError('BAD_REQUEST', '任务不存在')
    if (task.status !== 'awaiting_approval') throw new TaskBoardError('BAD_REQUEST', `任务状态不允许应用：${task.status}`)
    return this.update(task, { status: 'applying' })
  }

  completeAfterApproval(taskId: string, result: TaskResult): TaskRecord {
    const task = this.get(taskId)
    if (!task) throw new TaskBoardError('BAD_REQUEST', '任务不存在')
    const status: TaskStatus = result.ok ? 'completed' : 'failed'
    this.finish(task, status, result)
    return this.get(taskId)!
  }

  rejectApproval(taskId: string): TaskRecord {
    const task = this.get(taskId)
    if (!task) throw new TaskBoardError('BAD_REQUEST', '任务不存在')
    const result: TaskResult = {
      ok: false,
      didWhat: task.result?.didWhat ?? [],
      changes: [],
      findings: task.result?.findings,
      leftover: ['用户拒绝审批'],
      stats: { durationSec: task.result?.stats.durationSec ?? 0 },
    }
    this.finish(task, 'rejected', result)
    return this.get(taskId)!
  }

  private pump(agentType: AgentType): void {
    const limit = TASK_CONCURRENCY[agentType]
    if (limit < 1 || this.running[agentType]) return
    const nextId = this.waiting[agentType].shift()
    if (!nextId) return
    const task = this.get(nextId)
    if (!task || task.status !== 'queued') {
      this.pump(agentType)
      return
    }
    this.running[agentType] = task.id
    void this.run(task).finally(() => {
      this.running[agentType] = null
      this.aborters.delete(task.id)
      this.pump(agentType)
    })
  }

  private async run(task: TaskRecord): Promise<void> {
    const started = Date.now()
    const controller = new AbortController()
    this.aborters.set(task.id, controller)
    this.update(task, { status: 'running' })
    this.progress(task.id, '开始处理')
    try {
      const result = await this.executor(task, {
        signal: controller.signal,
        progress: (note) => this.progress(task.id, note),
        usage: (delta) => this.usage(task.id, delta),
      })
      const latest = this.get(task.id)
      if (!latest || TERMINAL.includes(latest.status)) return
      const durationSec = Math.max(0, Math.round((Date.now() - started) / 1000))
      const finalResult = { ...result, stats: { ...result.stats, durationSec } }
      const status: TaskStatus = finalResult.ok ? 'completed' : 'failed'
      this.finish(latest, status, finalResult)
    } catch (err) {
      const latest = this.get(task.id)
      if (!latest || TERMINAL.includes(latest.status)) return
      if (err instanceof TaskAwaitingApproval) {
        const next = this.update(latest, {
          status: 'awaiting_approval',
          planId: err.planId,
          result: err.result,
        })
        this.publish({ t: 'awaiting_approval', taskId: next.id, planId: err.planId, digest: err.digest })
        this.deps.onAwaitingApproval?.(next, err.digest)
        return
      }
      if (controller.signal.aborted) {
        this.finish(latest, 'cancelled')
        return
      }
      this.finish(latest, 'failed', failedResult(err, Math.max(0, Math.round((Date.now() - started) / 1000))))
    }
  }

  private finish(task: TaskRecord, status: TaskStatus, result?: TaskResult): void {
    const next: TaskRecord = { ...task, status, endedAt: Date.now(), result }
    this.write(next)
    this.publish({ t: 'result', taskId: next.id, status, result })
    this.deps.enqueueResult?.(next)
    this.deps.onResult?.(next)
  }

  private update(task: TaskRecord, patch: Partial<TaskRecord>): TaskRecord {
    const next = { ...task, ...patch }
    this.write(next)
    return next
  }

  private progress(taskId: string, note: string): void {
    this.publish({ t: 'progress', taskId, note: note.slice(0, 30) })
  }

  private usage(taskId: string, delta: Partial<TaskRecord['usage']>): void {
    const latest = this.get(taskId)
    if (!latest || TERMINAL.includes(latest.status)) return
    this.write({
      ...latest,
      usage: {
        toolCalls: latest.usage.toolCalls + (delta.toolCalls ?? 0),
        tokens: latest.usage.tokens + (delta.tokens ?? 0),
      },
    })
  }

  private publish(event: TaskEvent): void {
    this.deps.emit({ type: IPC.TASK_EVENT, payload: event })
  }

  private pathFor(taskId: string): string {
    const id = taskId.startsWith('task_') ? taskId : `task_${taskId}`
    return join(this.deps.tasksDir, `${id}.json`)
  }

  private safeRead(path: string): TaskRecord | null {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as TaskRecord
      return isTaskRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private write(task: TaskRecord): void {
    const path = this.pathFor(task.id)
    const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
    writeFileSync(tmp, JSON.stringify(task, null, 2))
    renameSync(tmp, path)
  }
}

function makeTaskId(): string {
  return `task_${Date.now()}_${randomBytes(2).toString('hex')}`
}

function validateDispatch(input: DispatchRequest, config: Config): DispatchRequest {
  if (typeof input?.goal !== 'string' || !input.goal.trim()) {
    throw new TaskBoardError('BAD_REQUEST', 'goal 必填')
  }
  if (input.agentType !== 'worker' && input.agentType !== 'explore') {
    throw new TaskBoardError('BAD_REQUEST', 'agentType 必须是 worker/explore')
  }
  const dirs = input.scope?.dirs
  if (!Array.isArray(dirs) || dirs.length === 0 || typeof input.scope?.net !== 'boolean') {
    throw new TaskBoardError('BAD_REQUEST', 'scope.dirs 与 scope.net 必填')
  }
  const normalizedDirs = dirs.map(normalizeScope)
  const allowed = config.scopes.map(normalizeScope)
  const outside = normalizedDirs.find((dir) => !allowed.some((base) => isWithinScope(base, dir)))
  if (outside) throw new TaskBoardError('SCOPE_VIOLATION', `scope 超出授权目录：${outside}`)
  return {
    goal: input.goal.trim(),
    agentType: input.agentType,
    scope: { dirs: normalizedDirs, net: input.scope.net },
    skill: typeof input.skill === 'string' && input.skill.trim() ? input.skill.trim() : undefined,
  }
}

function normalizeScope(path: string): string {
  // 为什么展开 ~：DEFAULT_CONFIG.scopes 用 ~ 写白名单，而 dispatch 传绝对路径；
  // 不展开则默认配置下所有 dispatch 必然 SCOPE_VIOLATION（真机 smoke 实测）
  const raw = String(path ?? '')
  const expanded = raw.startsWith('~') ? `${homedir()}${raw.slice(1)}` : raw
  return expanded.replace(/\\/g, '/').replace(/\/+$/g, '') || '/'
}

function isWithinScope(base: string, candidate: string): boolean {
  return candidate === base || candidate.startsWith(`${base}/`)
}

function isSafeTaskId(taskId: string): boolean {
  return /^task_[A-Za-z0-9_-]+$/.test(taskId)
}

function isTaskRecord(x: unknown): x is TaskRecord {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return typeof r.id === 'string' && r.id.startsWith('task_') && typeof r.goal === 'string'
}

async function defaultExecutor(task: TaskRecord, ctx: TaskExecutorContext): Promise<TaskResult> {
  await sleep(20, ctx.signal)
  ctx.progress('任务板已记录')
  await sleep(20, ctx.signal)
  return {
    ok: true,
    didWhat: ['已创建任务记录', '已通过任务板串行调度'],
    changes: [],
    leftover: ['子 Agent 执行器、重工具、staging、审批和 undo 尚未接入'],
    findings: task.agentType === 'explore' ? ['任务板链路已打通，等待接入 explore 执行器'] : undefined,
    stats: { durationSec: 0 },
  }
}

function failedResult(err: unknown, durationSec: number): TaskResult {
  return {
    ok: false,
    didWhat: [],
    changes: [],
    leftover: [err instanceof Error ? err.message : String(err)],
    stats: { durationSec },
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('cancelled'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    }, { once: true })
  })
}

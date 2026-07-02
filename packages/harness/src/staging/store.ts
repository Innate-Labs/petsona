// M2 staging / approval / undo store. File mutations are first recorded as plans,
// then applied after APPROVAL_DECISION, with a small undo journal.

import {
  copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { FileOp, FileOpKind, PlanDigest, StagingPlan, UndoFailure } from '@petsona/shared'
import { STAGING_MAX_OPS } from '@petsona/shared'
import type { DataPaths } from '../paths.js'

type PendingOp = FileOp

type UndoEntry =
  | { opId: string; op: 'write'; dst: string; existed: boolean; beforePath?: string }
  | { opId: string; op: 'mkdir'; dst: string }
  | { opId: string; op: 'move' | 'rename'; src: string; dst: string }
  | { opId: string; op: 'trash'; src: string; trashPath: string }

type UndoJournal = {
  planId: string
  taskId: string
  appliedAt: number
  entries: UndoEntry[]
}

export type ApplyOutcome = {
  plan: StagingPlan
  applied: number
  failed: UndoFailure[]
}

export class StagingStore {
  private pending = new Map<string, PendingOp[]>()

  constructor(private paths: DataPaths) {
    mkdirSync(paths.stagingDir, { recursive: true })
    mkdirSync(paths.plansDir, { recursive: true })
    mkdirSync(paths.undoDir, { recursive: true })
  }

  stageWrite(taskId: string, dst: string, content: string, append = false): FileOp {
    const opId = makeOpId('write')
    const dir = join(this.paths.stagingDir, taskId)
    mkdirSync(dir, { recursive: true })
    const stagingPath = join(dir, `${opId}.txt`)
    const body = append && existsSync(dst) ? `${readFileSync(dst, 'utf8')}${content}` : content
    writeFileSync(stagingPath, body)
    const op: FileOp = {
      opId,
      op: 'write',
      dst,
      stagingPath,
      bytes: statSync(stagingPath).size,
      overwrite: existsSync(dst),
    }
    this.push(taskId, op)
    return op
  }

  stageMove(taskId: string, op: 'move' | 'rename', src: string, dst: string): FileOp {
    const fileOp: FileOp = { opId: makeOpId(op), op, src, dst }
    this.push(taskId, fileOp)
    return fileOp
  }

  stageTrash(taskId: string, src: string): FileOp {
    const op: FileOp = { opId: makeOpId('trash'), op: 'trash', src }
    this.push(taskId, op)
    return op
  }

  hasPending(taskId: string): boolean {
    return (this.pending.get(taskId)?.length ?? 0) > 0
  }

  createPlan(taskId: string): StagingPlan {
    const ops = this.pending.get(taskId) ?? []
    if (ops.length === 0) throw new Error('没有待审批操作')
    if (ops.length > STAGING_MAX_OPS) throw new Error(`staging 操作超过上限：${ops.length}/${STAGING_MAX_OPS}`)
    const plan: StagingPlan = {
      planId: `plan_${Date.now()}_${randomBytes(2).toString('hex')}`,
      taskId,
      createdAt: Date.now(),
      ops,
      digest: digestOps(ops),
      status: 'draft',
    }
    this.writePlan(plan)
    this.pending.delete(taskId)
    return plan
  }

  get(planId: string): StagingPlan | null {
    if (!isSafeId(planId, 'plan_')) return null
    try {
      return JSON.parse(readFileSync(this.planPath(planId), 'utf8')) as StagingPlan
    } catch {
      return null
    }
  }

  reject(planId: string): StagingPlan {
    const plan = this.requirePlan(planId)
    const next: StagingPlan = { ...plan, status: 'rejected' }
    this.writePlan(next)
    return next
  }

  apply(planId: string, excludedOpIds: string[] = []): ApplyOutcome {
    const plan = this.requirePlan(planId)
    if (plan.status !== 'draft' && plan.status !== 'approved' && plan.status !== 'partial') {
      throw new Error(`计划状态不允许应用：${plan.status}`)
    }
    const excluded = new Set(excludedOpIds)
    const selected = plan.ops.filter((op) => !excluded.has(op.opId))
    const preStatus: StagingPlan['status'] = excluded.size > 0 ? 'partial' : 'approved'
    this.writePlan({ ...plan, status: preStatus })

    const entries: UndoEntry[] = []
    const failed: UndoFailure[] = []
    for (const op of selected) {
      try {
        entries.push(this.applyOp(plan, op))
      } catch (err) {
        failed.push({ opId: op.opId, reason: err instanceof Error ? err.message : String(err) })
        break
      }
    }

    const status: StagingPlan['status'] = failed.length ? 'apply_failed' : 'applied'
    const next: StagingPlan = { ...plan, status }
    this.writePlan(next)
    if (entries.length) this.writeJournal({ planId: plan.planId, taskId: plan.taskId, appliedAt: Date.now(), entries })
    return { plan: next, applied: entries.length, failed }
  }

  undo(planId: string): { ok: boolean; restored: number; failed: UndoFailure[] } {
    const plan = this.requirePlan(planId)
    const journal = this.requireJournal(planId)
    const failed: UndoFailure[] = []
    let restored = 0
    for (const entry of [...journal.entries].reverse()) {
      try {
        this.undoEntry(entry)
        restored += 1
      } catch (err) {
        failed.push({ opId: entry.opId, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (failed.length === 0) this.writePlan({ ...plan, status: 'undone' })
    return { ok: failed.length === 0, restored, failed }
  }

  private push(taskId: string, op: PendingOp): void {
    const ops = this.pending.get(taskId) ?? []
    ops.push(op)
    this.pending.set(taskId, ops)
  }

  private applyOp(plan: StagingPlan, op: FileOp): UndoEntry {
    const journalDir = join(this.paths.undoDir, plan.planId)
    mkdirSync(journalDir, { recursive: true })
    switch (op.op) {
      case 'write': {
        mkdirSync(dirname(op.dst), { recursive: true })
        const existed = existsSync(op.dst)
        const beforePath = existed ? join(journalDir, `${op.opId}.before`) : undefined
        if (beforePath) copyFileSync(op.dst, beforePath)
        copyFileSync(op.stagingPath, op.dst)
        return { opId: op.opId, op: 'write', dst: op.dst, existed, beforePath }
      }
      case 'mkdir':
        mkdirSync(op.dst, { recursive: true })
        return { opId: op.opId, op: 'mkdir', dst: op.dst }
      case 'move':
      case 'rename':
        if (existsSync(op.dst)) throw new Error(`目标已存在：${op.dst}`)
        mkdirSync(dirname(op.dst), { recursive: true })
        renameSync(op.src, op.dst)
        return { opId: op.opId, op: op.op, src: op.src, dst: op.dst }
      case 'trash': {
        const trashPath = join(journalDir, `${op.opId}_${op.src.split('/').pop() || 'item'}`)
        renameSync(op.src, trashPath)
        return { opId: op.opId, op: 'trash', src: op.src, trashPath }
      }
    }
  }

  private undoEntry(entry: UndoEntry): void {
    switch (entry.op) {
      case 'write':
        if (entry.existed && entry.beforePath) copyFileSync(entry.beforePath, entry.dst)
        else rmSync(entry.dst, { force: true })
        return
      case 'mkdir':
        rmdirSync(entry.dst)
        return
      case 'move':
      case 'rename':
        mkdirSync(dirname(entry.src), { recursive: true })
        renameSync(entry.dst, entry.src)
        return
      case 'trash':
        mkdirSync(dirname(entry.src), { recursive: true })
        renameSync(entry.trashPath, entry.src)
        return
    }
  }

  private requirePlan(planId: string): StagingPlan {
    const plan = this.get(planId)
    if (!plan) throw new Error('计划不存在')
    return plan
  }

  private requireJournal(planId: string): UndoJournal {
    try {
      return JSON.parse(readFileSync(this.journalPath(planId), 'utf8')) as UndoJournal
    } catch {
      throw new Error('撤销日志不存在')
    }
  }

  private writePlan(plan: StagingPlan): void {
    writeJsonAtomic(this.planPath(plan.planId), plan)
  }

  private writeJournal(journal: UndoJournal): void {
    writeJsonAtomic(this.journalPath(journal.planId), journal)
  }

  private planPath(planId: string): string {
    return join(this.paths.plansDir, `${planId}.json`)
  }

  private journalPath(planId: string): string {
    return join(this.paths.undoDir, `${planId}.json`)
  }
}

function digestOps(ops: FileOp[]): PlanDigest {
  const counts: Record<FileOpKind, number> = { write: 0, mkdir: 0, move: 0, rename: 0, trash: 0 }
  const byDir = new Map<string, number>()
  for (const op of ops) {
    counts[op.op] += 1
    const dir = dirname('dst' in op ? op.dst : op.src)
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
  }
  return {
    counts,
    byDir: [...byDir.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dir, n]) => ({ dir, n })),
    samples: ops.slice(0, 5).map(sampleOp),
    risk: ops.some((op) => op.op === 'trash') ? 'L2' : 'L1',
  }
}

function sampleOp(op: FileOp): string {
  switch (op.op) {
    case 'write': return `${op.overwrite ? '覆盖' : '写入'} ${op.dst}`
    case 'mkdir': return `创建目录 ${op.dst}`
    case 'move': return `移动 ${op.src} -> ${op.dst}`
    case 'rename': return `重命名 ${op.src} -> ${op.dst}`
    case 'trash': return `移入回收 ${op.src}`
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

function makeOpId(kind: FileOpKind): string {
  return `op_${kind}_${Date.now()}_${randomBytes(2).toString('hex')}`
}

function isSafeId(id: string, prefix: string): boolean {
  return id.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(id)
}

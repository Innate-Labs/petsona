// panel/Approval.tsx —— 审批清单（PLAN_GET / APPROVAL_DECISION / UNDO_REQUEST）

import { useEffect, useMemo, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { StagingPlan, TaskEventPayload, TaskListGetRes, TaskRecord, UndoRequestRes } from '@petsona/shared'
import { on, request } from '../lib/ipc'

export function Approval() {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [plan, setPlan] = useState<StagingPlan | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const candidates = useMemo(
    () => tasks.filter((t) => t.planId && ['awaiting_approval', 'completed', 'failed'].includes(t.status)),
    [tasks],
  )
  const selected = candidates.find((t) => t.id === selectedId) ?? candidates[0]

  useEffect(() => {
    void refresh()
    return on<TaskEventPayload>(IPC.TASK_EVENT, (event) => {
      if (event.t === 'awaiting_approval' || event.t === 'result') void refresh()
    })
  }, [])

  useEffect(() => {
    if (!selected?.planId) {
      setPlan(null)
      return
    }
    setSelectedId(selected.id)
    setExcluded(new Set())
    void request<{ plan: StagingPlan }>(IPC.PLAN_GET, { planId: selected.planId })
      .then((res) => setPlan(res.plan))
      .catch((err) => setNote(err instanceof Error ? err.message : String(err)))
  }, [selected?.id, selected?.planId])

  async function refresh() {
    const res = await request<TaskListGetRes>(IPC.TASK_LIST_GET, {})
    setTasks(res.tasks)
  }

  async function decide(decision: 'approve' | 'reject' | 'partial') {
    if (!plan) return
    setBusy(true)
    setNote('')
    try {
      await request(IPC.APPROVAL_DECISION, {
        planId: plan.planId,
        decision,
        excludedOpIds: decision === 'partial' ? [...excluded] : [],
      })
      setNote(decision === 'reject' ? '已拒绝' : '已应用')
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!plan) return
    setBusy(true)
    setNote('')
    try {
      const res = await request<UndoRequestRes>(IPC.UNDO_REQUEST, { planId: plan.planId })
      setNote(res.ok ? `已撤销 ${res.restored} 项` : `撤销失败 ${res.failed.length} 项`)
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function toggle(opId: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(opId)) next.delete(opId)
      else next.add(opId)
      return next
    })
  }

  if (candidates.length === 0) {
    return <div className="placeholder">暂无审批</div>
  }

  return (
    <div className="approval">
      <div className="approval-list">
        {candidates.map((task) => (
          <button
            key={task.id}
            className={`approval-row ${task.id === selected?.id ? 'approval-row--active' : ''}`}
            onClick={() => setSelectedId(task.id)}
          >
            <span className="approval-row-title">{task.goal}</span>
            <span className="approval-row-status">{task.status}</span>
          </button>
        ))}
      </div>

      {plan ? (
        <div className="approval-detail">
          <div className="approval-summary">
            <span>{plan.digest.risk}</span>
            <span>{Object.entries(plan.digest.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ')}</span>
          </div>
          <div className="approval-samples">
            {plan.ops.map((op) => (
              <label key={op.opId} className="approval-op">
                <input
                  type="checkbox"
                  checked={!excluded.has(op.opId)}
                  disabled={selected?.status !== 'awaiting_approval'}
                  onChange={() => toggle(op.opId)}
                />
                <span>{opLabel(op)}</span>
              </label>
            ))}
          </div>
          <div className="approval-actions">
            {selected?.status === 'awaiting_approval' ? (
              <>
                <button disabled={busy} onClick={() => void decide('approve')}>批准</button>
                <button disabled={busy || excluded.size === 0} onClick={() => void decide('partial')}>部分批准</button>
                <button disabled={busy} onClick={() => void decide('reject')}>拒绝</button>
              </>
            ) : (
              <button disabled={busy || plan.status === 'undone'} onClick={() => void undo()}>撤销</button>
            )}
          </div>
          {note ? <p className="approval-note">{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function opLabel(op: StagingPlan['ops'][number]): string {
  switch (op.op) {
    case 'write': return `${op.overwrite ? '覆盖' : '写入'} ${op.dst}`
    case 'mkdir': return `创建 ${op.dst}`
    case 'move': return `移动 ${op.src} -> ${op.dst}`
    case 'rename': return `重命名 ${op.src} -> ${op.dst}`
    case 'trash': return `回收 ${op.src}`
  }
}

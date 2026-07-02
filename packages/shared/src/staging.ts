// §3.4 Staging 计划（s18 变体 · 审批与撤销的数据真源）

export type FileOp =
  | { opId: string; op: 'write'; dst: string; stagingPath: string; bytes: number; overwrite: boolean }
  | { opId: string; op: 'mkdir'; dst: string }
  | { opId: string; op: 'move'; src: string; dst: string }
  | { opId: string; op: 'rename'; src: string; dst: string }
  | { opId: string; op: 'trash'; src: string }              // 只进废纸篓，无 delete op

export type FileOpKind = FileOp['op']

export type PlanStatus =
  | 'draft' | 'approved' | 'partial' | 'rejected' | 'applied' | 'undone' | 'apply_failed'

export type PlanDigest = {                                   // 审批气泡/面板的展示数据
  counts: Record<FileOpKind, number>
  byDir: { dir: string; n: number }[]                        // top5
  samples: string[]                                          // 前 5 条人类可读："移动 报销单.pdf → 2026报销/"
  risk: 'L1' | 'L2'
}

export type StagingPlan = {
  planId: string
  taskId: string
  createdAt: number
  ops: FileOp[]                                              // 上限 500 条，超限任务直接 failed
  digest: PlanDigest
  status: PlanStatus
}

export const STAGING_MAX_OPS = 500
export const UNDO_RETENTION_DAYS = 7      // 计划应用后 7 天内可撤销，之后 journal 归档

// $DATA 布局（§2.3）：~/Library/Application Support/Petsona/<userId>/
// dev 可用 PETSONA_DATA_DIR 覆盖根路径；登录前用 anon-<deviceId>

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

export function dataRoot(): string {
  return process.env.PETSONA_DATA_DIR || join(homedir(), 'Library/Application Support/Petsona')
}

// SPEC-GAP: 规格未定义 deviceId 生成与存放，落在 $ROOT/device.json（不含隐私，仅 uuid）
export function deviceId(): string {
  const p = join(dataRoot(), 'device.json')
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      if (typeof parsed.deviceId === 'string') return parsed.deviceId
    } catch { /* 损坏则重新生成 */ }
  }
  const id = randomUUID().slice(0, 8)
  mkdirSync(dataRoot(), { recursive: true })
  writeFileSync(p, JSON.stringify({ deviceId: id }))
  return id
}

export type DataPaths = {
  root: string          // $DATA = <dataRoot>/<userId>
  config: string
  persona: string
  skills: string
  personas: string
  memoryDir: string
  memoryIndex: string   // memory/MEMORY.md
  coldDir: string       // memory/cold/
  sessionsDb: string    // memory/sessions.db
  tasksDir: string
  stagingDir: string
  plansDir: string
  undoDir: string
  scheduled: string
  proactive: string     // 主动气泡历史（p02 频控与语义去重跨重启存活）
  outputsDir: string
  logsDir: string
  auditLog: string
}

export function resolvePaths(userId: string): DataPaths {
  const root = join(dataRoot(), userId)
  const p: DataPaths = {
    root,
    config: join(root, 'config.json'),
    persona: join(root, 'persona.json'),
    skills: join(root, 'skills'),
    personas: join(root, 'personas'),
    memoryDir: join(root, 'memory'),
    memoryIndex: join(root, 'memory/MEMORY.md'),
    coldDir: join(root, 'memory/cold'),
    sessionsDb: join(root, 'memory/sessions.db'),
    tasksDir: join(root, 'tasks'),
    stagingDir: join(root, 'staging'),
    plansDir: join(root, 'plans'),
    undoDir: join(root, 'undo'),
    scheduled: join(root, 'scheduled.json'),
    proactive: join(root, 'proactive.json'),
    outputsDir: join(root, 'outputs'),
    logsDir: join(root, 'logs'),
    auditLog: join(root, 'logs/audit.jsonl'),
  }
  for (const dir of [root, p.skills, p.personas, p.memoryDir, p.coldDir, p.tasksDir,
    p.stagingDir, p.plansDir, p.undoDir, p.outputsDir, p.logsDir]) {
    mkdirSync(dir, { recursive: true })
  }
  return p
}

export function anonUserId(): string {
  return `anon-${deviceId()}`
}

// ---- 匿名 → 登录目录迁移（H10 / §2.3 桌面端本地部分；v2.1 §3.3.4 是服务端 SQL） ----
// 为什么下次启动而非登录当下迁移：main.ts 装配时把 $DATA 句柄（SQLite 连接、cold 目录、
// 调度器/心跳/提醒的落盘路径）分发给 10+ 子系统；LOGIN 时热切目录得逐一 close/reopen，
// 出错撤销复杂。桌面通行做法（Slack/Notion 同）是记账+下次启动落地。

export type PendingMigration = { from: string; to: string; email: string; ts: number }

/** 邮箱 → 稳定 userId（sha256 前 12 位 hex）。不含明文邮箱，隐私对齐 §2.3 device.json 纪律。 */
export function userIdFromEmail(email: string): string {
  return `user-${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12)}`
}

function pendingPath(root: string): string {
  return join(root, 'pending-migration.json')
}

/** 记账：LOGIN_SUBMIT 成功后调用；返回目标 userId 供 UI 提示（"重启后完成同步"）。
    重复登录同一账号 = 目标已存在时不覆盖已有目录，只记账下轮清理 anon 残余。 */
export function writePending(root: string, from: string, email: string): PendingMigration {
  const item: PendingMigration = { from, to: userIdFromEmail(email), email, ts: Date.now() }
  mkdirSync(root, { recursive: true })
  writeFileSync(pendingPath(root), JSON.stringify(item, null, 2))
  return item
}

export function readPending(root: string): PendingMigration | null {
  const p = pendingPath(root)
  if (!existsSync(p)) return null
  try {
    const obj = JSON.parse(readFileSync(p, 'utf8'))
    if (typeof obj?.from === 'string' && typeof obj?.to === 'string') return obj
  } catch { /* 损坏当无 */ }
  return null
}

/** 启动时先跑：读 pending → 落地目录切换。返回最终 userId。
    - pending 不存在 → 原样返回 fallback（一般是 anonUserId()）
    - 源目录不存在（首次装机、已经迁过）→ 直接采用目标 id，删 pending
    - 目标目录已存在（同账号再登） → 把 from 归档到 <root>/.trash/anon-<ts>/，采用目标 id
    - 正常迁移 → renameSync（同盘原子），删 pending */
export function applyPendingMigration(root: string, fallback: string): string {
  const pending = readPending(root)
  if (!pending) return fallback
  const fromDir = join(root, pending.from)
  const toDir = join(root, pending.to)
  try {
    const targetIsDir = existsSync(toDir) && statSync(toDir).isDirectory()
    const targetIsBlocked = existsSync(toDir) && !targetIsDir   // 目标位点被非目录占据 → 拒迁
    if (targetIsBlocked) throw new Error(`目标 ${toDir} 被非目录占据，无法迁移`)
    if (!existsSync(fromDir)) {
      // 干净首启已登录用户；或已经迁过
    } else if (targetIsDir) {
      // 同账号再次登录：禁 rm，归档到 .trash/
      const trashDir = join(root, '.trash')
      mkdirSync(trashDir, { recursive: true })
      renameSync(fromDir, join(trashDir, `${pending.from}.${pending.ts}`))
    } else {
      mkdirSync(root, { recursive: true })
      renameSync(fromDir, toDir)
    }
    unlinkSync(pendingPath(root))
    return pending.to
  } catch (err) {
    // 迁移失败保留 pending 下次再试，先按 fallback 起来别把用户锁死
    console.error('[paths] 迁移失败，pending 保留下次重试:', err)
    return fallback
  }
}

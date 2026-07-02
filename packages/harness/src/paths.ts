// $DATA 布局（§2.3）：~/Library/Application Support/Petsona/<userId>/
// dev 可用 PETSONA_DATA_DIR 覆盖根路径；登录前用 anon-<deviceId>

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

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

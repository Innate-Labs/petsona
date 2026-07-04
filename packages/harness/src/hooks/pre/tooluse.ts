// PreToolUse 固定管线：permission → scope → audit（§3.7）
// M1 陪伴循环只有轻工具（L0/L1），无 L2 审批路径；结构完整、逻辑按级别生效

import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type { AuditEntry, PermissionLevel } from '@petsona/shared'
import { BUILTIN_L3_RULES, IPC } from '@petsona/shared'
import type { PreToolUseHook, PostToolUseHook } from '../pipeline.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { FallbackPool } from '../../persona/fallback_pool.js'

type ToolLookup = Pick<ToolRegistry, 'get'>

/** 求值（§3.5 简化版）：M1 无 user 规则，取工具注册默认级；builtin L3 短路一切 */
export function evaluateLevel(reg: ToolLookup, tool: string, input: unknown): { level: PermissionLevel; ruleId?: string } {
  const inputStr = JSON.stringify(input ?? {})
  for (const rule of BUILTIN_L3_RULES) {
    if (rule.tool !== tool) continue
    if (rule.match?.cmdRegex && !new RegExp(rule.match.cmdRegex).test(inputStr)) continue
    if (rule.match?.pathGlob && !inputPaths(input).some((p) => globMatch(rule.match!.pathGlob!, p))) continue
    return { level: 'L3', ruleId: rule.id }
  }
  const def = reg.get(tool)
  return { level: def?.defaultLevel ?? 'L3' }
}

export function makePermissionHook(reg: ToolLookup, pool: FallbackPool, emit: (e: { type: string; payload: unknown }) => void): PreToolUseHook {
  return async (call) => {
    const { level } = evaluateLevel(reg, call.tool, call.input)
    if (level === 'L3') {
      return { block: 'PERMISSION_DENIED' as const, message: `工具 ${call.tool} 被内置 L3 规则禁止` }
    }
    if (level === 'L1') {
      // L1=通知：发气泡但不拦截（如 dispatch_task「去干活啦」）
      emit({
        type: IPC.PET_BUBBLE,
        payload: { text: pool.pick(call.tool), durationMs: 4000, kind: 'task' },
      })
    }
    if (level === 'L2') {
      return { block: 'PERMISSION_DENIED' as const, message: `工具 ${call.tool} 需要审批，当前审批链路尚未接入` }
    }
  }
}

export const scopeHook: PreToolUseHook = async (call) => {
  if (call.tool === 'web_fetch' && call.scope && !call.scope.net) {
    return { block: 'SCOPE_VIOLATION' as const, message: '此任务未授权联网' }
  }
  if (!call.scope) return

  const paths = inputPaths(call.input)
  const scopeBase = call.scope.dirs[0] ?? process.cwd()
  if (call.tool === 'shell' || call.tool === 'applescript') {
    const cwd = typeof (call.input as { cwd?: unknown } | null)?.cwd === 'string'
      ? (call.input as { cwd: string }).cwd
      : scopeBase
    paths.push(cwd)
  }
  if (paths.length === 0) return

  const allowed = call.scope.dirs.map((dir) => normalizePath(dir))
  for (const p of paths) {
    const normalized = normalizePath(p, scopeBase)
    if (!allowed.some((base) => normalized === base || normalized.startsWith(`${base}/`))) {
      return { block: 'SCOPE_VIOLATION' as const, message: `路径超出任务 scope：${p}` }
    }
  }
}

export function makeAuditHook(auditPath: string, reg: ToolLookup): PreToolUseHook {
  return async (call) => {
    const { level, ruleId } = evaluateLevel(reg, call.tool, call.input)
    const entry: AuditEntry = {
      t: Date.now(),
      taskId: call.taskId,
      tool: call.tool,
      inputDigest: createHash('sha256').update(JSON.stringify(call.input ?? {})).digest('hex').slice(0, 12),
      level,
      ruleId,
      decision: level === 'L3' ? 'deny' : level === 'L1' ? 'notify' : 'allow',
    }
    appendFileSync(auditPath, JSON.stringify(entry) + '\n')
  }
}

// ---------- PostToolUse：persist_large(>30K) → staging_record → progress_mirror ----------

export function makePersistLargeHook(outputsDir: string): PostToolUseHook {
  return async (call, output) => {
    if (output.length <= 30_000) return output
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(outputsDir, call.taskId ?? 'companion')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${call.tool}_${Date.now()}.txt`)
    writeFileSync(file, output)
    return `${output.slice(0, 2000)}\n…（输出 ${output.length} 字符已落盘：${file}）`
  }
}

export const stagingRecordHook: PostToolUseHook = async (_call, output) => output   // M2：staging 计划记录
export const progressMirrorHook: PostToolUseHook = async (_call, output) => output  // M2：todo/进度镜像 TASK_EVENT

function inputPaths(input: unknown): string[] {
  const out: string[] = []
  const visit = (v: unknown, key = '') => {
    if (typeof v === 'string' && /^(path|from|to|cwd|file|dir)$/i.test(key)) out.push(v)
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key))
    else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) visit(val, k)
    }
  }
  visit(input)
  return out
}

function normalizePath(path: string, base?: string): string {
  const expanded = path.startsWith('~') ? `${homedir()}${path.slice(1)}` : path
  const basePath = base ? normalizePath(base) : process.cwd()
  return resolve(isAbsolute(expanded) ? expanded : resolve(basePath, expanded)).replace(/\\/g, '/')
}

function globMatch(glob: string, path: string): boolean {
  const normalizedGlob = glob.startsWith('~') ? `${homedir()}${glob.slice(1)}` : glob
  const normalizedPath = path.startsWith('~') ? `${homedir()}${path.slice(1)}` : path
  const esc = normalizedGlob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
  return new RegExp(`^${esc}$`).test(normalizedPath.replace(/\\/g, '/'))
}

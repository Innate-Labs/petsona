// PreToolUse 固定管线：permission → scope → audit（§3.7）
// M1 陪伴循环只有轻工具（L0/L1），无 L2 审批路径；结构完整、逻辑按级别生效

import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { AuditEntry, PermissionLevel } from '@petsona/shared'
import { BUILTIN_L3_RULES, IPC } from '@petsona/shared'
import type { PreToolUseHook, PostToolUseHook } from '../pipeline.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { FallbackPool } from '../../persona/fallback_pool.js'

/** 求值（§3.5 简化版）：M1 无 user 规则，取工具注册默认级；builtin L3 短路一切 */
export function evaluateLevel(reg: ToolRegistry, tool: string, input: unknown): { level: PermissionLevel; ruleId?: string } {
  const inputStr = JSON.stringify(input ?? {})
  for (const rule of BUILTIN_L3_RULES) {
    if (rule.tool !== tool) continue
    if (rule.match?.cmdRegex && !new RegExp(rule.match.cmdRegex).test(inputStr)) continue
    return { level: 'L3', ruleId: rule.id }
  }
  const def = reg.get(tool)
  return { level: def?.defaultLevel ?? 'L3' }
}

export function makePermissionHook(reg: ToolRegistry, pool: FallbackPool, emit: (e: { type: string; payload: unknown }) => void): PreToolUseHook {
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
    // L2=确认走 staging 聚合审批（M2）；companion 轻工具无 L2
  }
}

export const scopeHook: PreToolUseHook = async () => {
  // 轻工具不触达文件系统 scope；重工具 scope 校验随 M2 子 Agent 落地（结构位保留）
}

export function makeAuditHook(auditPath: string, reg: ToolRegistry): PreToolUseHook {
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

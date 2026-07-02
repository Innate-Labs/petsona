// §3.5 权限规则合并与求值骨架（完整求值随 M2 重工具落地；结构性约束 M1 即生效）
// 结构性约束（§10）：builtin 的 L3 不可被 user 规则降级——违规在合并期直接抛错

import type { PermissionRule } from '@petsona/shared'
import { BUILTIN_L3_RULES } from '@petsona/shared'

export function mergeRules(userRules: PermissionRule[]): PermissionRule[] {
  for (const rule of userRules) {
    if (rule.source !== 'user') {
      throw new Error(`外部注入规则 ${rule.id} 伪装 source=${rule.source}，拒绝合并`)
    }
    const shadowed = BUILTIN_L3_RULES.find(
      (b) => b.tool === rule.tool && sameMatch(b.match, rule.match) && rule.level !== 'L3',
    )
    if (shadowed) {
      throw new Error(`结构性约束违规：user 规则 ${rule.id} 试图降级 builtin L3（${shadowed.id}）`)
    }
  }
  // builtin 恒在前（求值时 L3 短路一切）
  return [...BUILTIN_L3_RULES, ...userRules]
}

/** 求值排序辅助：最特化优先（match 字段多者），同特化取更严级别（§3.5） */
export function specificity(rule: PermissionRule): number {
  return (rule.match?.pathGlob ? 1 : 0) + (rule.match?.cmdRegex ? 1 : 0)
}

function sameMatch(a?: PermissionRule['match'], b?: PermissionRule['match']): boolean {
  return (a?.pathGlob ?? '') === (b?.pathGlob ?? '') && (a?.cmdRegex ?? '') === (b?.cmdRegex ?? '')
}

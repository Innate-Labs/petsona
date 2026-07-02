// 兜底文案池（缝②的一半：不走 LLM 的直出文案；每条 ≥3 变体轮换，§7）

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ErrCode } from '@petsona/shared'

export class FallbackPool {
  private pools = new Map<string, string[]>()
  private cursor = new Map<string, number>()

  /** 加载 $DATA/fallback/*.json（首启由 bootstrap 从 packages/assets 拷入） */
  load(fallbackDir: string): void {
    if (!existsSync(fallbackDir)) return
    for (const f of readdirSync(fallbackDir)) {
      if (!f.endsWith('.json')) continue
      const data = JSON.parse(readFileSync(join(fallbackDir, f), 'utf8')) as Record<string, string[]>
      for (const [key, variants] of Object.entries(data)) {
        if (Array.isArray(variants) && variants.length > 0) this.pools.set(key, variants)
      }
    }
  }

  /** 变体轮换（顺序轮转，保证同 key 连续触发不重复） */
  pick(key: string): string {
    const variants = this.pools.get(key) ?? this.pools.get('generic_error') ?? ['…（文案池未加载）']
    const i = this.cursor.get(key) ?? 0
    this.cursor.set(key, (i + 1) % variants.length)
    return variants[i % variants.length]!
  }

  has(key: string): boolean {
    return this.pools.has(key)
  }

  size(): number {
    return this.pools.size
  }

  /** ErrCode → 文案池 key 映射 */
  forError(code: ErrCode): string {
    const map: Partial<Record<ErrCode, string>> = {
      TIMEOUT: 'llm_timeout',
      UPSTREAM: 'llm_unreachable',
      RATE_LIMIT: 'rate_limit',
      CONTENT_FILTER: 'content_filter',
      OS_PERMISSION_MISSING: 'os_permission_missing',
      STAGING_APPLY_FAILED: 'staging_apply_failed',
      APPROVAL_TIMEOUT: 'approval_timeout',
      TASK_BUDGET_EXCEEDED: 'task_budget_exceeded',
      SIDECAR_DOWN: 'sidecar_crash_recovered',
      DISK_FULL: 'disk_full',
      SCOPE_VIOLATION: 'scope_violation',
      UNAUTHENTICATED: 'keychain_denied',
    }
    return this.pick(map[code] ?? 'generic_error')
  }
}

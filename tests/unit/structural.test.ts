// §10 结构性约束单测（CI 必跑）——四道缝的机器强制

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolRegistry } from '../../packages/harness/src/tools/registry.js'
import { mergeRules } from '../../packages/harness/src/permission/rules.js'
import type { PermissionRule, ToolDef } from '@petsona/shared'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe('结构性约束：companion 循环禁注册重工具', () => {
  const heavyDef: ToolDef = {
    name: 'fs_write',
    description: '重工具',
    inputSchema: {},
    loop: 'companion',   // 恶意/失误声明成 companion 也拦（按名单拦截）
    defaultLevel: 'L1',
    handler: async () => 'x',
  }

  it('companion registry 注册 heavy 名单工具 → 抛错', () => {
    const reg = new ToolRegistry('companion')
    expect(() => reg.register(heavyDef)).toThrowError(/结构性约束/)
  })

  it('loop 声明与 registry 不符 → 抛错', () => {
    const reg = new ToolRegistry('companion')
    expect(() =>
      reg.register({ ...heavyDef, name: 'some_tool', loop: 'subagent' }),
    ).toThrowError(/不能注册进/)
  })
})

describe('结构性约束：builtin L3 不可被 user 规则降级', () => {
  it('user 规则试图降级 builtin L3 → 抛错', () => {
    const evil: PermissionRule = {
      id: 'user-allow-sudo',
      tool: 'shell',
      match: { cmdRegex: '(^|\\s|;|&|\\|)sudo(\\s|$)' },
      level: 'L0',
      source: 'user',
    }
    expect(() => mergeRules([evil])).toThrowError(/结构性约束违规/)
  })

  it('正常 user 规则可合并且 builtin 恒在前', () => {
    const ok: PermissionRule = {
      id: 'user-downloads-move',
      tool: 'fs_move',
      match: { pathGlob: '~/Downloads/**' },
      level: 'L1',
      source: 'user',
      ttl: 'forever',
    }
    const merged = mergeRules([ok])
    expect(merged[0]!.source).toBe('builtin')
    expect(merged.at(-1)!.id).toBe('user-downloads-move')
  })
})

describe('缝①：harness 内网络出口唯一（gateway/client.ts）', () => {
  it('fetch(/axios 不出现在 gateway/client.ts 之外', () => {
    const files = walk(join(ROOT, 'packages/harness/src'))
    const offenders: string[] = []
    for (const f of files) {
      const rel = relative(ROOT, f)
      if (rel.endsWith('gateway/client.ts')) continue
      const src = readFileSync(f, 'utf8')
      // fetch( 调用或 axios 引入；排除注释行
      const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      if (lines.some((l) => /\bfetch\s*\(|from ['"]axios['"]|require\(['"]axios['"]\)/.test(l))) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('缝（继承 v2.1）：vendor SDK import 只许在网关 provider 实现内', () => {
  it('anthropic/openai SDK 不出现在 providers/ 之外（harness/shared/shell 全域禁止）', () => {
    const scanDirs = [
      join(ROOT, 'packages/harness/src'),
      join(ROOT, 'packages/shared/src'),
      join(ROOT, 'apps/shell/ui'),
      join(ROOT, 'apps/gateway/src'),
    ]
    const offenders: string[] = []
    for (const dir of scanDirs) {
      for (const f of walk(dir)) {
        const rel = relative(ROOT, f)
        if (rel.includes('gateway/src/providers/')) continue
        const src = readFileSync(f, 'utf8')
        if (/from ['"]@anthropic-ai\/|from ['"]openai['"]|from ['"]@google\/generative/.test(src)) {
          offenders.push(rel)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('缝④：token 禁落磁盘', () => {
  it('harness 内不出现把 token 写文件的代码（keychain.ts 之外无 accessToken 持久化）', () => {
    const files = walk(join(ROOT, 'packages/harness/src'))
    const offenders: string[] = []
    for (const f of files) {
      const rel = relative(ROOT, f)
      if (rel.endsWith('gateway/keychain.ts') || rel.endsWith('gateway/client.ts')) continue
      const src = readFileSync(f, 'utf8')
      if (/writeFileSync\([^)]*[tT]oken/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})

describe('缝（M3 §3.8）：调度器不直接调 LLM', () => {
  it('scheduler/ 不 import gateway', () => {
    const files = walk(join(ROOT, 'packages/harness/src/scheduler'))
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      if (lines.some((l) => /gateway\/client|from ['"]\.\.\/gateway/.test(l))) offenders.push(relative(ROOT, f))
    }
    expect(offenders).toEqual([])
  })
})

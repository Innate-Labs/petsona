// 匿名→登录目录迁移（H10 / §2.3）：下次启动落地，禁 rm，同账号复登归档
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyPendingMigration, readPending, userIdFromEmail, writePending,
} from '../../packages/harness/src/paths.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'petsona-mig-'))
})

const seedUserDir = (uid: string, files: Record<string, string> = {}) => {
  const dir = join(root, uid)
  mkdirSync(dir, { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, body)
  }
  return dir
}

describe('userIdFromEmail', () => {
  it('大小写与前后空白等价，产出 user- 前缀 + 12 位 hex', () => {
    const a = userIdFromEmail('user@example.com')
    expect(userIdFromEmail('  User@Example.COM  ')).toBe(a)
    expect(a).toMatch(/^user-[0-9a-f]{12}$/)
    expect(userIdFromEmail('other@example.com')).not.toBe(a)   // 不同邮箱不同 id
  })
})

describe('writePending / readPending', () => {
  it('roundtrip 保留 from/to/email/ts', () => {
    const item = writePending(root, 'anon-abc', 'me@x.com')
    expect(item.from).toBe('anon-abc')
    expect(item.to).toBe(userIdFromEmail('me@x.com'))
    expect(item.email).toBe('me@x.com')
    const loaded = readPending(root)
    expect(loaded).toEqual(item)
  })
  it('损坏 JSON → null 不抛', () => {
    writeFileSync(join(root, 'pending-migration.json'), '{oops')
    expect(readPending(root)).toBeNull()
  })
})

describe('applyPendingMigration', () => {
  it('无 pending → 返回 fallback，不动目录', () => {
    seedUserDir('anon-abc', { 'config.json': '{}' })
    expect(applyPendingMigration(root, 'anon-abc')).toBe('anon-abc')
    expect(existsSync(join(root, 'anon-abc/config.json'))).toBe(true)
  })

  it('正常迁移：from→to 原子搬迁，pending 落地后删除', () => {
    seedUserDir('anon-abc', { 'config.json': '{"gatewayUrl":"x"}', 'memory/MEMORY.md': '- keep' })
    const item = writePending(root, 'anon-abc', 'me@x.com')
    const result = applyPendingMigration(root, 'anon-abc')
    expect(result).toBe(item.to)
    expect(existsSync(join(root, 'anon-abc'))).toBe(false)
    expect(readFileSync(join(root, item.to, 'config.json'), 'utf8')).toBe('{"gatewayUrl":"x"}')
    expect(readFileSync(join(root, item.to, 'memory/MEMORY.md'), 'utf8')).toBe('- keep')
    expect(readPending(root)).toBeNull()
  })

  it('目标已存在（同账号再登） → 归档到 .trash/，不覆盖已有数据，禁 rm', () => {
    seedUserDir('anon-abc', { 'stale.json': 'old' })
    const to = userIdFromEmail('me@x.com')
    seedUserDir(to, { 'kept.json': 'live' })
    writePending(root, 'anon-abc', 'me@x.com')
    expect(applyPendingMigration(root, 'anon-abc')).toBe(to)
    // 已有目标数据保住
    expect(readFileSync(join(root, to, 'kept.json'), 'utf8')).toBe('live')
    expect(existsSync(join(root, to, 'stale.json'))).toBe(false)
    // 旧 anon 目录归档不删（缝：$DATA 内清理走移动）
    expect(existsSync(join(root, 'anon-abc'))).toBe(false)
    const trashed = readdirSync(join(root, '.trash'))
    expect(trashed.some((n) => n.startsWith('anon-abc.'))).toBe(true)
    expect(readFileSync(join(root, '.trash', trashed[0]!, 'stale.json'), 'utf8')).toBe('old')
    expect(readPending(root)).toBeNull()
  })

  it('源目录不存在（首次装机已登录用户 / 已迁过）→ 采用目标 id 并清 pending', () => {
    writePending(root, 'anon-abc', 'me@x.com')
    const to = userIdFromEmail('me@x.com')
    expect(applyPendingMigration(root, 'anon-abc')).toBe(to)
    expect(readPending(root)).toBeNull()
  })

  it('pending 存在但迁移抛错 → 返回 fallback、保留 pending 下轮重试', () => {
    // 制造无法 rename 的情况：把 pending.to 建成文件（不是目录）
    const to = userIdFromEmail('me@x.com')
    writeFileSync(join(root, to), 'not a dir')   // 目标位点已被文件占据
    seedUserDir('anon-abc', { 'config.json': '{}' })
    writePending(root, 'anon-abc', 'me@x.com')
    const result = applyPendingMigration(root, 'anon-abc')
    expect(result).toBe('anon-abc')                   // 保留 anon 起来
    expect(readPending(root)).not.toBeNull()          // 下轮再试
    expect(existsSync(join(root, 'anon-abc'))).toBe(true)
  })
})

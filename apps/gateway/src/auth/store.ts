// 用户 / 验证码 / refresh 白名单存储
// SPEC-GAP: v2.1 §2.5 用 Postgres（users/verify_codes/refresh_tokens 表）+ Redis；
// 桌面 M1 网关按任务约定用内存 Map + 可选 JSON 文件持久化（env AUTH_STORE_FILE），
// 表结构语义（attempts 计数、jti revoke 白名单、device_id 关联）保持一致，后续换库只改本文件。

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from '../env.js'

// passwordHash：scrypt 输出（salt.hex.hash.hex），首次密码登录时写入；code 路径老用户可为空
export type User = { id: string; email: string; deviceId?: string; banned: boolean; createdAt: number; passwordHash?: string }
type CodeRow = { code: string; expiresAt: number; attempts: number }
type RefreshRow = { userId: string; expiresAt: number; revokedAt?: number }

const users = new Map<string, User>()            // email → User
const codes = new Map<string, CodeRow>()         // email → 最新验证码（v2.1 verify_codes 语义）
const refreshRows = new Map<string, RefreshRow>()// jti → 白名单行（v2.1 refresh_tokens 语义）

const CODE_MAX_ATTEMPTS = 5   // SPEC-GAP: v2.1 只说 attempts 计数，未给上限，行业默认 5 次锁码

// —— 验证码 ——

export function issueCode(email: string): { code: string; ttl: number } {
  const ttl = env.emailCodeTtl()
  const len = env.emailCodeLength()
  const code = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0')
  codes.set(email, { code, expiresAt: Date.now() + ttl * 1000, attempts: 0 })
  return { code, ttl }
}

export function verifyCode(email: string, input: string): boolean {
  // dev 模式固定码直通（任务约定：NODE_ENV!=='production' 时接受 DEV_FIXED_CODE）
  if (!env.isProd() && input === env.devFixedCode()) return true
  const row = codes.get(email)
  if (!row || Date.now() > row.expiresAt || row.attempts >= CODE_MAX_ATTEMPTS) return false
  row.attempts += 1
  if (row.code !== input) return false
  codes.delete(email)   // 一次性消费
  return true
}

// —— 用户 ——

export function upsertUser(email: string, deviceId?: string): User {
  let u = users.get(email)
  const isNew = !u
  if (!u) {
    u = { id: randomUUID(), email, banned: false, createdAt: Date.now() }
    users.set(email, u)
  }
  // 匿名→登录迁移（v2.1 §3.3.4）：deviceId 关联到 user；M1 网关无 memory_warm/cold 库，
  // 关联关系存在 user 行上，供 /v1/memory/sync 按 deviceId 归户
  if (deviceId) u.deviceId = deviceId
  persist()
  return isNew ? u : u
}

export function findUserByEmail(email: string): User | undefined {
  return users.get(email)
}

export function findUserById(id: string): User | undefined {
  for (const u of users.values()) if (u.id === id) return u
  return undefined
}

export function isNewUser(email: string): boolean {
  return !users.has(email)
}

/** 首次密码登录：给已存在 user 补 hash；不覆盖已有 hash（改密走另一路径，规格未定不实现） */
export function setUserPassword(email: string, hash: string): void {
  const u = users.get(email)
  if (!u) return
  if (u.passwordHash) return
  u.passwordHash = hash
  persist()
}

// —— refresh 白名单（滚动刷新：旧 jti 立即 revoke）——

export function saveRefresh(jti: string, userId: string, ttlMs: number): void {
  refreshRows.set(jti, { userId, expiresAt: Date.now() + ttlMs })
  persist()
}

export function isRefreshValid(jti: string, userId: string): boolean {
  const row = refreshRows.get(jti)
  return !!row && row.userId === userId && !row.revokedAt && Date.now() < row.expiresAt
}

export function revokeRefresh(jti: string): void {
  const row = refreshRows.get(jti)
  if (row) row.revokedAt = Date.now()
  persist()
}

// —— 可选 JSON 持久化（AUTH_STORE_FILE）——
// 为什么同步写：M1 单实例低频写，简单可靠优先；量大后换 SQLite/Postgres 时整体替换。

let loaded = false

export function loadStore(): void {
  if (loaded) return
  loaded = true
  const file = env.authStoreFile()
  if (!file) return
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      users?: [string, User][]
      refresh?: [string, RefreshRow][]
    }
    for (const [k, v] of raw.users ?? []) users.set(k, v)
    for (const [k, v] of raw.refresh ?? []) refreshRows.set(k, v)
  } catch {
    /* 文件不存在/损坏 → 从空库开始（首次启动是常态路径） */
  }
}

function persist(): void {
  const file = env.authStoreFile()
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    // 验证码是短命敏感数据，不落盘
    writeFileSync(file, JSON.stringify({ users: [...users], refresh: [...refreshRows] }))
  } catch (e) {
    console.warn(`[gateway] AUTH_STORE_FILE 写入失败：${e instanceof Error ? e.message : e}`)
  }
}

export function resetAuthStore(): void {
  users.clear()
  codes.clear()
  refreshRows.clear()
  loaded = false
}

// 密码哈希（scrypt，Node 内置，零依赖）
// 存储格式 salt.hex + '.' + hash.hex；verify 用 timingSafeEqual 防时序攻击。
// 为什么用 scrypt 而不是 bcrypt/argon2：Node stdlib 直供、无编译原生模块、CPU/内存代价可调；
// 桌面 M1 单机低频登录，参数按 Node 默认足够安全（N=16384, r=8, p=1，64B 输出）。

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const HASH_LEN = 64
const SALT_LEN = 16

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, HASH_LEN)
  return `${salt.toString('hex')}.${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const dot = stored.indexOf('.')
  if (dot < 0) return false
  const salt = Buffer.from(stored.slice(0, dot), 'hex')
  const expected = Buffer.from(stored.slice(dot + 1), 'hex')
  if (salt.length !== SALT_LEN || expected.length !== HASH_LEN) return false
  const actual = scryptSync(password, salt, HASH_LEN)
  return timingSafeEqual(expected, actual)
}

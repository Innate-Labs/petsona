// JWT 签发/校验（v2.1 §3.3.2 payload 规范；桌面差异：aud=petsona-desktop）
// HS256 对称密钥；access/refresh 双 secret（缺省都回落 JWT_SECRET → dev-secret）。

import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { env } from '../env.js'

export type AccessPayload = {
  sub: string
  email: string
  type: 'access'
  iat: number
  exp: number
  iss: string
  aud: string
}

export type RefreshPayload = {
  sub: string
  jti: string
  type: 'refresh'
  iat: number
  exp: number
  iss: string
  aud: string
}

export function signAccess(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email, type: 'access' }, env.jwtAccessSecret(), {
    algorithm: 'HS256',
    expiresIn: env.jwtAccessTtl() as jwt.SignOptions['expiresIn'],
    issuer: env.jwtIssuer(),
    audience: env.jwtAudience(),
  })
}

export function signRefresh(userId: string): { token: string; jti: string } {
  const jti = randomUUID()
  const token = jwt.sign({ sub: userId, jti, type: 'refresh' }, env.jwtRefreshSecret(), {
    algorithm: 'HS256',
    expiresIn: env.jwtRefreshTtl() as jwt.SignOptions['expiresIn'],
    issuer: env.jwtIssuer(),
    audience: env.jwtAudience(),
  })
  return { token, jti }
}

export function verifyAccess(token: string): AccessPayload | null {
  try {
    const p = jwt.verify(token, env.jwtAccessSecret(), {
      algorithms: ['HS256'],
      issuer: env.jwtIssuer(),
      audience: env.jwtAudience(),
    }) as AccessPayload
    return p.type === 'access' ? p : null
  } catch {
    return null
  }
}

export function verifyRefresh(token: string): RefreshPayload | null {
  try {
    const p = jwt.verify(token, env.jwtRefreshSecret(), {
      algorithms: ['HS256'],
      issuer: env.jwtIssuer(),
      audience: env.jwtAudience(),
    }) as RefreshPayload
    return p.type === 'refresh' && typeof p.jti === 'string' ? p : null
  } catch {
    return null
  }
}

// 从请求头解出已验证的 access payload；失败返回 null（路由统一回 401 UNAUTHENTICATED）
export function requireUser(req: FastifyRequest): AccessPayload | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  return verifyAccess(h.slice(7))
}

// /v1/auth/* 五端点（v2.1 §3.3.1 原文移植；桌面差异：aud=petsona-desktop、token 由客户端存 Keychain 不落盘）

import type { FastifyInstance } from 'fastify'
import { env } from '../env.js'
import { errBody } from '../lib/http.js'
import { checkAndCountAuthCode } from '../governance.js'
import { requireUser, signAccess, signRefresh, verifyRefresh } from '../auth/jwt.js'
import {
  findUserByEmail, findUserById, isNewUser, isRefreshValid, issueCode,
  loadStore, revokeRefresh, saveRefresh, upsertUser, verifyCode,
} from '../auth/store.js'

// v2.1 §3.3 邮箱格式校验（SPEC-GAP: 规格未给正则，取宽松 RFC 近似）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function issueTokenPair(userId: string, email: string): { accessToken: string; refreshToken: string } {
  const accessToken = signAccess(userId, email)
  const { token: refreshToken, jti } = signRefresh(userId)
  const p = verifyRefresh(refreshToken)!   // 刚签发必有效，借 exp 算白名单过期
  saveRefresh(jti, userId, p.exp * 1000 - Date.now())
  return { accessToken, refreshToken }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  loadStore()

  // —— POST /v1/auth/request-code：请求验证码 ——
  app.post('/v1/auth/request-code', async (req, reply) => {
    const { email } = (req.body ?? {}) as { email?: string }
    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send(errBody('INVALID_EMAIL', '邮箱格式不合法'))
    }
    if (!checkAndCountAuthCode(req.ip)) {
      return reply.code(429).send(errBody('RATE_LIMIT', '验证码请求太频繁了，请一小时后再试'))
    }
    const { code, ttl } = issueCode(email)
    if (env.isProd()) {
      // TODO(SPEC-GAP): 生产模式接邮件服务（v2.1 §2.4 EMAIL_PROVIDER=smtp|resend|sendgrid），
      // M1 网关未接 SMTP，先记日志占位；接入后发送失败应返回 502 UPSTREAM
      console.warn(`[gateway] 生产模式未配置邮件服务，验证码未发送（email=${email}）`)
    } else {
      // dev 模式：验证码打印到 console，另接受 DEV_FIXED_CODE（默认 888888）
      console.log(`[gateway][dev] 验证码 ${email} → ${code}（或用固定码 ${env.devFixedCode()}）`)
    }
    return reply.send({ ok: true, ttl })
  })

  // —— POST /v1/auth/login：验证码换 JWT ——
  app.post('/v1/auth/login', async (req, reply) => {
    const { email, code, deviceId } = (req.body ?? {}) as { email?: string; code?: string; deviceId?: string }
    if (!email || !EMAIL_RE.test(email) || !code) {
      return reply.code(400).send(errBody('BAD_REQUEST', '缺少邮箱或验证码'))
    }
    const existing = findUserByEmail(email)
    if (existing?.banned) {
      return reply.code(403).send(errBody('USER_BANNED', '账号已被封禁'))
    }
    if (!verifyCode(email, code)) {
      return reply.code(401).send(errBody('INVALID_CODE', '验证码错误或已过期'))
    }
    const firstTime = isNewUser(email)
    // 匿名→登录迁移（v2.1 §3.3.4）：deviceId 关联进 user，匿名期记忆归户
    const user = upsertUser(email, deviceId)
    if (firstTime) console.log(`[gateway] 新用户注册 ${user.id}（埋点 1003 由客户端上报）`)
    return reply.send({ ...issueTokenPair(user.id, user.email), user: { id: user.id, email: user.email } })
  })

  // —— POST /v1/auth/refresh：滚动刷新（旧 refresh 立即 revoke）——
  app.post('/v1/auth/refresh', async (req, reply) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string }
    const p = refreshToken ? verifyRefresh(refreshToken) : null
    if (!p || !isRefreshValid(p.jti, p.sub)) {
      return reply.code(401).send(errBody('INVALID_REFRESH', '登录已过期，请重新登录'))
    }
    const user = findUserById(p.sub)
    if (!user || user.banned) {
      return reply.code(401).send(errBody('INVALID_REFRESH', '登录已失效，请重新登录'))
    }
    revokeRefresh(p.jti)   // 旧 refresh 立即 revoked_at=NOW()（v2.1 原文）
    return reply.send(issueTokenPair(user.id, user.email))
  })

  // —— POST /v1/auth/logout：revoke 该 refresh 的 jti ——
  app.post('/v1/auth/logout', async (req, reply) => {
    const auth = requireUser(req)
    if (!auth) return reply.code(401).send(errBody('UNAUTHENTICATED', '请先登录'))
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string }
    const p = refreshToken ? verifyRefresh(refreshToken) : null
    if (p) revokeRefresh(p.jti)
    return reply.send({ ok: true })
  })

  // —— GET /v1/auth/me：当前登录态 ——
  app.get('/v1/auth/me', async (req, reply) => {
    const auth = requireUser(req)
    if (!auth) return reply.code(401).send(errBody('UNAUTHENTICATED', '请先登录'))
    return reply.send({ id: auth.sub, email: auth.email, loginState: 'logged_in' })
  })
}

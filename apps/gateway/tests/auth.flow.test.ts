// /v1/auth/* 全流程测试（v2.1 §3.3）：request-code → dev 固定码 login → JWT(aud) → refresh → logout
// dev 模式（NODE_ENV!=='production'）接受 DEV_FIXED_CODE（默认 888888），无需真实邮件。

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { resetGovernance } from '../src/governance.js'
import { resetAuthStore } from '../src/auth/store.js'

const EMAIL = 'pet@petsona.dev'

describe('auth 全流程', () => {
  let app: FastifyInstance
  let accessToken = ''
  let refreshToken = ''

  beforeAll(async () => {
    process.env.RATE_LIMIT_AUTH_PER_HOUR = '100'   // 流程内多次 request-code 不触发限流（限流单测另开）
    resetGovernance()
    resetAuthStore()
    app = await buildServer()
  })

  afterAll(async () => {
    await app.close()
    delete process.env.RATE_LIMIT_AUTH_PER_HOUR
  })

  it('request-code：合法邮箱返回 ok+ttl；非法邮箱 400 INVALID_EMAIL', async () => {
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/request-code', payload: { email: EMAIL } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ ok: true, ttl: 600 })

    const bad = await app.inject({ method: 'POST', url: '/v1/auth/request-code', payload: { email: '不是邮箱' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('INVALID_EMAIL')
  })

  it('login：错误验证码 401 INVALID_CODE；dev 固定码换 JWT 且 aud=petsona-desktop', async () => {
    const wrong = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: EMAIL, code: '000000', deviceId: 'anon-dev-1' },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('INVALID_CODE')

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: EMAIL, code: '888888', deviceId: 'anon-dev-1' },
    })
    expect(res.statusCode).toBe(200)
    const json = res.json() as { accessToken: string; refreshToken: string; user: { id: string; email: string } }
    expect(json.user.email).toBe(EMAIL)
    accessToken = json.accessToken
    refreshToken = json.refreshToken

    // JWT payload 按 v2.1 §3.3.2；桌面差异 aud=petsona-desktop
    const access = jwt.decode(accessToken) as Record<string, unknown>
    expect(access.aud).toBe('petsona-desktop')
    expect(access.iss).toBe('petsona')
    expect(access.type).toBe('access')
    expect(access.email).toBe(EMAIL)
    const refresh = jwt.decode(refreshToken) as Record<string, unknown>
    expect(refresh.aud).toBe('petsona-desktop')
    expect(refresh.type).toBe('refresh')
    expect(typeof refresh.jti).toBe('string')
  })

  it('me：带 access 返回登录态；不带 401 UNAUTHENTICATED', async () => {
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } })
    expect(me.statusCode).toBe(200)
    expect(me.json().loginState).toBe('logged_in')

    const anon = await app.inject({ method: 'GET', url: '/v1/auth/me' })
    expect(anon.statusCode).toBe(401)
    expect(anon.json().error.code).toBe('UNAUTHENTICATED')
  })

  it('refresh：滚动刷新——拿到新对，旧 refresh 立即失效', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } })
    expect(res.statusCode).toBe(200)
    const json = res.json() as { accessToken: string; refreshToken: string }
    expect(json.refreshToken).not.toBe(refreshToken)

    // 旧 refresh 已 revoke → 401 INVALID_REFRESH
    const replay = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } })
    expect(replay.statusCode).toBe(401)
    expect(replay.json().error.code).toBe('INVALID_REFRESH')

    accessToken = json.accessToken
    refreshToken = json.refreshToken
  })

  it('logout：revoke 当前 refresh；之后 refresh 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const after = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } })
    expect(after.statusCode).toBe(401)
  })

  it('request-code 限流：触 RATE_LIMIT_AUTH_PER_HOUR 返回 429', async () => {
    process.env.RATE_LIMIT_AUTH_PER_HOUR = '1'
    resetGovernance()   // 清掉前面用例的计数，从 0 开始验证阈值
    const first = await app.inject({ method: 'POST', url: '/v1/auth/request-code', payload: { email: EMAIL } })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({ method: 'POST', url: '/v1/auth/request-code', payload: { email: EMAIL } })
    expect(second.statusCode).toBe(429)
    expect(second.json().error.code).toBe('RATE_LIMIT')
  })
})

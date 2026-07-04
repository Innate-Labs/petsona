// /v1/proxy/fetch 冒烟：鉴权 + URL 校验 + SSRF 拦截 + 真实抓取（本测试内自起 http 服务）

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { signAccess } from '../src/auth/jwt.js'

const auth = { authorization: `Bearer ${signAccess('proxy-user', 'p@test.dev')}` }

describe('/v1/proxy/fetch', () => {
  let app: FastifyInstance
  let upstream: Server
  let upstreamUrl = ''

  beforeAll(async () => {
    app = await buildServer()
    upstream = createServer((req, res) => {
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('x'.repeat(50_000))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>宠格代理测试页</html>')
    })
    await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok))
    const addr = upstream.address()
    upstreamUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
  })
  afterAll(async () => {
    await app.close()
    upstream.close()
  })

  it('401：未登录', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/proxy/fetch', payload: { url: 'https://example.com' } })
    expect(res.statusCode).toBe(401)
  })

  it('400：非法 URL / 非 http(s) / 内网目标全部拒绝', async () => {
    for (const url of ['not-a-url', 'ftp://example.com/x', 'http://127.0.0.1:8787/healthz', 'http://192.168.1.1/', 'http://localhost/x', 'http://169.254.169.254/latest', 'http://10.0.0.5/', 'http://172.16.0.1/']) {
      const res = await app.inject({ method: 'POST', url: '/v1/proxy/fetch', headers: auth, payload: { url } })
      expect(res.statusCode, url).toBe(400)
    }
  })

  it('真实抓取：返回 status/contentType/text；maxBytes 截断置 truncated', async () => {
    process.env.PETSONA_PROXY_ALLOW_LOOPBACK = '1'
    try {
      const res = await app.inject({
        method: 'POST', url: '/v1/proxy/fetch', headers: auth, payload: { url: `${upstreamUrl}/page` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { ok: boolean; status: number; contentType: string; text: string; truncated: boolean }
      expect(body.ok).toBe(true)
      expect(body.status).toBe(200)
      expect(body.contentType).toContain('text/html')
      expect(body.text).toContain('宠格代理测试页')
      expect(body.truncated).toBe(false)

      const big = await app.inject({
        method: 'POST', url: '/v1/proxy/fetch', headers: auth, payload: { url: `${upstreamUrl}/big`, maxBytes: 1000 },
      })
      const bigBody = big.json() as { text: string; truncated: boolean }
      expect(bigBody.truncated).toBe(true)
      expect(bigBody.text.length).toBeLessThanOrEqual(1000)
    } finally {
      delete process.env.PETSONA_PROXY_ALLOW_LOOPBACK
    }
  })
})

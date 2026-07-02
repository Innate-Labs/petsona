// POST /v1/proxy/fetch（M2 web_fetch 网关代理）
// 为什么放网关：harness 网络出口唯一（缝①），子 Agent 联网必须经网关代为抓取；
// 网关侧做 SSRF 防护 + 大小/超时上限，harness 只拿回文本。

import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth/jwt.js'
import { errBody } from '../lib/http.js'

const FETCH_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 200_000
const HARD_MAX_BYTES = 1_000_000

/** 拦内网/环回目标：代理只服务公网抓取，不给子 Agent 探测本机与内网的口子 */
function isBlockedHost(hostname: string): boolean {
  // 测试专用逃生口：单测在 127.0.0.1 自起 http 服务验证真实抓取路径
  if (process.env.PETSONA_PROXY_ALLOW_LOOPBACK === '1') return false
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local / 云元数据
  return false
}

export function registerProxyRoutes(app: FastifyInstance): void {
  app.post('/v1/proxy/fetch', async (req, reply) => {
    const auth = requireUser(req)
    if (!auth) return reply.code(401).send(errBody('UNAUTHENTICATED', '请先登录'))

    const body = (req.body ?? {}) as { url?: unknown; maxBytes?: unknown }
    let target: URL
    try {
      target = new URL(String(body.url ?? ''))
    } catch {
      return reply.code(400).send(errBody('BAD_REQUEST', 'url 不是合法 URL'))
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return reply.code(400).send(errBody('BAD_REQUEST', '只支持 http/https'))
    }
    if (isBlockedHost(target.hostname)) {
      return reply.code(400).send(errBody('BAD_REQUEST', '目标地址不允许（内网/环回）'))
    }
    const maxBytes = Math.min(
      Math.max(1, Number(body.maxBytes ?? DEFAULT_MAX_BYTES) || DEFAULT_MAX_BYTES),
      HARD_MAX_BYTES,
    )

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(target, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'petsona-gateway/3.0 (+web_fetch proxy)' },
        redirect: 'follow',
      })
      const reader = res.body?.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      let truncated = false
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          chunks.push(value)
          if (received >= maxBytes) {
            truncated = true
            await reader.cancel()
            break
          }
        }
      }
      const buf = Buffer.concat(chunks).subarray(0, maxBytes)
      return reply.send({
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        finalUrl: res.url,
        truncated,
        text: buf.toString('utf8'),
      })
    } catch (err) {
      const timedOut = ctrl.signal.aborted
      return reply
        .code(timedOut ? 504 : 502)
        .send(errBody('UPSTREAM', timedOut ? '抓取超时' : `抓取失败: ${err instanceof Error ? err.message : err}`))
    } finally {
      clearTimeout(timer)
    }
  })
}

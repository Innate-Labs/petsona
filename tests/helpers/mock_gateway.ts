// 测试用 mock 网关：实现 harness 依赖的最小契约（auth/llm SSE/track）
// 与 apps/gateway 的 MockProvider 行为对齐；用于 Gate 用例的 hermetic 运行

import { createServer, type Server } from 'node:http'

export type MockGatewayOptions = {
  fixedCode?: string
  chatReply?: string
}

export function startMockGateway(opts: MockGatewayOptions = {}): Promise<{ url: string; server: Server; calls: string[] }> {
  const fixedCode = opts.fixedCode ?? '888888'
  const chatReply = opts.chatReply ?? '喵！我在呢，今天过得怎么样呀？'
  const calls: string[] = []

  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`)
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {}
      if (req.url === '/v1/auth/request-code') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ttlSec: 600 }))
      } else if (req.url === '/v1/auth/login') {
        // 与真网关对齐：路由是 /v1/auth/login，email 在 user 里（真机 smoke 抓过错位教训）
        if (json.code !== fixedCode) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'bad code' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          accessToken: 'test-access',
          refreshToken: 'test-refresh',
          user: { id: 'test-user', email: json.email },
        }))
      } else if (req.url === '/v1/auth/logout') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else if (req.url === '/v1/llm/chat') {
        if (json.stream === false) {
          // 非流式（tagTurn/extract/bubble 的 cheap 调用）：回空数组文本，避免污染记忆断言
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ content: [{ type: 'text', text: '[]' }], stopReason: 'end_turn', usage: { in: 10, out: 5 } }))
          return
        }
        // SSE 四事件帧：按 4 字符每帧吐 delta
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const text = json.messages?.length ? chatReply : chatReply
        for (let i = 0; i < text.length; i += 4) {
          res.write(`event: delta\ndata: ${JSON.stringify({ text: text.slice(i, i + 4) })}\n\n`)
        }
        res.write(`event: done\ndata: ${JSON.stringify({ stopReason: 'end_turn', usage: { in: 100, out: text.length } })}\n\n`)
        res.end()
      } else if (req.url === '/v1/track/batch') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ accepted: (json.events ?? []).length }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${addr.port}`, server, calls })
    })
  })
}

// /v1/llm/chat 集成测试（fastify inject，不占端口）
// 覆盖：SSE 四帧齐全与顺序、stream=false 路径、401、429 限流、402 TASK_BUDGET_EXCEEDED、426 版本门

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { signAccess } from '../src/auth/jwt.js'
import { resetGovernance } from '../src/governance.js'
import { resetProviderCache } from '../src/providers/factory.js'

type SseFrame = { event: string; data: Record<string, unknown> }

// 解析 inject 拿到的整段 SSE 文本 → 帧数组
function parseFrames(payload: string): SseFrame[] {
  return payload
    .split('\n\n')
    .filter((s) => s.trim().startsWith('event:'))
    .map((block) => {
      const event = /event: (\S+)/.exec(block)?.[1] ?? ''
      const data = JSON.parse(/data: (.*)/.exec(block)?.[1] ?? '{}') as Record<string, unknown>
      return { event, data }
    })
}

const MUTATED_ENVS = [
  'RATE_LIMIT_CHAT_PER_MIN',
  'TASK_MAX_TOKENS',
  'LLM_PROVIDER',
  'LLM_MAIN_API_KEY',
  'LLM_MAIN_BASE_URL',
  'LLM_MAIN_MODEL',
] as const

describe('POST /v1/llm/chat', () => {
  let app: FastifyInstance
  let seq = 0
  const bearer = () => `Bearer ${signAccess(`user-${++seq}`, 'u@test.dev')}`   // 每用例独立 userId，限流互不干扰

  beforeEach(async () => {
    process.env.LLM_PROVIDER = 'mock'
    resetGovernance()
    resetProviderCache()
    app = await buildServer()
  })

  afterEach(async () => {
    await app.close()
    for (const k of MUTATED_ENVS) delete process.env[k]
  })

  const chatBody = (over: Record<string, unknown> = {}) => ({
    tier: 'main',
    system: '',
    messages: [{ role: 'user', content: 'echo:这是一段用来验证流式分帧的比较长的回复内容，足够切成多帧。' }],
    stream: true,
    maxTokens: 1000,
    meta: { loop: 'companion' },
    ...over,
  })

  it('401：未带 token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/llm/chat', payload: chatBody() })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHENTICATED')
  })

  it('401：未登录且未带 BYOK key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/chat',
      headers: {
        'x-petsona-llm-base-url': 'https://api.deepseek.com/v1',
        'x-petsona-llm-model': 'deepseek-v4-flash',
      },
      payload: chatBody(),
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHENTICATED')
  })

  it('stream=true：四事件帧齐全、顺序正确（delta→tool_use→done）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/chat',
      headers: { authorization: bearer() },
      payload: chatBody({
        // echo-system 前缀保证有 delta；@tool 指令保证有 tool_use（mock 契约）
        system: 'echo-system:前缀',
        messages: [{ role: 'user', content: '@tool get_time {"tz":"utc"}' }],
        tools: [{ name: 'get_time', description: '查时间', input_schema: { type: 'object' } }],
      }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')

    const frames = parseFrames(res.payload)
    const kinds = frames.map((f) => f.event)
    expect(kinds).toContain('delta')
    expect(kinds).toContain('tool_use')
    expect(kinds[kinds.length - 1]).toBe('done')
    // 顺序：所有 delta 在 tool_use 之前，done 收尾
    expect(kinds.lastIndexOf('delta')).toBeLessThan(kinds.indexOf('tool_use'))

    const done = frames[frames.length - 1]!.data as { stopReason: string; usage: { in: number; out: number } }
    expect(done.stopReason).toBe('tool_use')
    expect(done.usage.in).toBeGreaterThan(0)
    const tool = frames.find((f) => f.event === 'tool_use')!.data as { id: string; name: string; input: unknown }
    expect(tool.name).toBe('get_time')
    expect(tool.input).toEqual({ tz: 'utc' })
  })

  it('stream=true：provider 抛错 → error 帧（四码）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/chat',
      headers: { authorization: bearer() },
      payload: chatBody({ messages: [{ role: 'user', content: 'trigger:UPSTREAM' }] }),
    })
    const frames = parseFrames(res.payload)
    expect(frames[frames.length - 1]!.event).toBe('error')
    expect((frames[frames.length - 1]!.data as { code: string }).code).toBe('UPSTREAM')
  })

  it('stream=false：一次性 JSON {content, stopReason, usage}', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/chat',
      headers: { authorization: bearer() },
      payload: chatBody({ stream: false, messages: [{ role: 'user', content: 'echo:非流式' }] }),
    })
    expect(res.statusCode).toBe(200)
    const json = res.json() as { content: { type: string; text?: string }[]; stopReason: string; usage: { in: number; out: number } }
    expect(json.content[0]).toEqual({ type: 'text', text: '非流式' })
    expect(json.stopReason).toBe('end_turn')
    expect(json.usage.out).toBeGreaterThan(0)
  })

  it('400：非法请求体（缺 meta.loop）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/chat',
      headers: { authorization: bearer() },
      payload: chatBody({ meta: {} }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('BAD_REQUEST')
  })

  it('429：分钟限流触发（rate:chat:min）', async () => {
    process.env.RATE_LIMIT_CHAT_PER_MIN = '2'
    const auth = bearer()   // 同一 userId 连打三次
    const hit = () => app.inject({
      method: 'POST', url: '/v1/llm/chat', headers: { authorization: auth },
      payload: chatBody({ stream: false }),
    })
    expect((await hit()).statusCode).toBe(200)
    expect((await hit()).statusCode).toBe(200)
    const third = await hit()
    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMIT')
  })

  it('402：subagent 任务 token 预算超限 → TASK_BUDGET_EXCEEDED', async () => {
    process.env.TASK_MAX_TOKENS = '1'
    const auth = bearer()
    const body = chatBody({
      stream: false,
      messages: [{ role: 'user', content: 'echo:任务循环产出的内容' }],
      meta: { loop: 'subagent', taskId: 'task-42' },
    })
    // 第一次：累计 0 < 1，放行并记账
    const first = await app.inject({ method: 'POST', url: '/v1/llm/chat', headers: { authorization: auth }, payload: body })
    expect(first.statusCode).toBe(200)
    // 第二次：累计已超网关上限 → 402
    const second = await app.inject({ method: 'POST', url: '/v1/llm/chat', headers: { authorization: auth }, payload: body })
    expect(second.statusCode).toBe(402)
    expect(second.json().error.code).toBe('TASK_BUDGET_EXCEEDED')
  })

  it('426：客户端版本低于 DESKTOP_MIN_VERSION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/chat',
      headers: { authorization: bearer(), 'x-petsona-version': '2.9.9' },
      payload: chatBody(),
    })
    expect(res.statusCode).toBe(426)
    expect(res.json().error.code).toBe('UPGRADE_REQUIRED')
  })

  it('BYOK：按请求覆盖 OpenAI-compatible Base URL 与 Model', async () => {
    const calls: Array<{ url: string; body: any; authorization: string | null }> = []
    const originalFetch = globalThis.fetch
    process.env.LLM_PROVIDER = 'mock'
    process.env.LLM_MAIN_API_KEY = 'env-key'
    process.env.LLM_MAIN_BASE_URL = 'https://env.example/v1'
    process.env.LLM_MAIN_MODEL = 'env-model'
    resetProviderCache()
    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/llm/chat',
        headers: {
          'x-petsona-user-llm-key': 'user-key',
          'x-petsona-llm-base-url': 'https://api.deepseek.com/v1',
          'x-petsona-llm-model': 'deepseek-v4-flash',
        },
        payload: chatBody({ stream: false }),
      })

      expect(res.statusCode).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        url: 'https://api.deepseek.com/v1/chat/completions',
        authorization: 'Bearer user-key',
      })
      expect(calls[0]?.body.model).toBe('deepseek-v4-flash')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

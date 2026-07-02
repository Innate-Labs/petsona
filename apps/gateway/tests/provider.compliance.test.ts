// LLMProvider 合规测试（v2.1 §2.1.1 provider.compliance.test.ts 原文条目）
// 原文测试清单为 7 条 MUST + 1 条 SHOULD；能力契约表中「错误分类四码可区分」也是 MUST
// （v3.0 §3.2 再次强调「错误分类四码必须可区分」），故第 8 条 MUST 按其语义补齐，SHOULD 保留在末尾。
// 测试目标从 env 拿（v2.1 原文 createProvider(env.LLM_UNDER_TEST)）；默认对 MockProvider 跑。

import { beforeAll, describe, expect, it } from 'vitest'
import type { LlmChatResponse, LlmMessage, LlmToolDef } from '@petsona/shared'
import { createProvider, resetProviderCache } from '../src/providers/factory.js'
import { ProviderError, type ProviderChunk } from '../src/providers/provider.js'

const TOOLS: LlmToolDef[] = [
  { name: 'get_time', description: '查当前时间', input_schema: { type: 'object' } },
]

function user(text: string): LlmMessage {
  return { role: 'user', content: text }
}

describe('LLMProvider compliance（8 MUST + 1 SHOULD）', () => {
  beforeAll(() => {
    // LLM_UNDER_TEST_PROVIDER 未配时默认 mock（v2.1 §2.4：默认复用 MAIN；桌面 M1 真源是 mock）
    process.env.LLM_PROVIDER = process.env.LLM_UNDER_TEST_PROVIDER || 'mock'
    resetProviderCache()
  })

  it('MUST: 非流式 chat 返回文本', async () => {
    const p = createProvider('main')
    const res = (await p.chat({ system: '', messages: [user('echo:你好世界')], stream: false })) as LlmChatResponse
    const text = res.content.find((b) => b.type === 'text')
    expect(text && 'text' in text ? text.text : '').toBe('你好世界')
    expect(res.stopReason).toBe('end_turn')
    expect(res.usage.in).toBeGreaterThan(0)
  })

  it('MUST: 流式 chat 首字 ≤2s', async () => {
    const p = createProvider('main')
    const start = Date.now()
    let firstDeltaAt = Infinity
    for await (const c of p.chat({ system: '', messages: [user('echo:流式测试内容流式测试内容')], stream: true }) as AsyncIterable<ProviderChunk>) {
      if (c.type === 'delta') { firstDeltaAt = Date.now(); break }
    }
    expect(firstDeltaAt - start).toBeLessThanOrEqual(2000)
  })

  it('MUST: Tool Use 循环终止并回带结果', async () => {
    const p = createProvider('main')
    // 第一轮：模型应产出 tool_use
    const r1 = (await p.chat({
      system: '', messages: [user('@tool get_time {"tz":"utc"}')], tools: TOOLS, stream: false,
    })) as LlmChatResponse
    const tu = r1.content.find((b) => b.type === 'tool_use')
    expect(tu).toBeTruthy()
    expect(r1.stopReason).toBe('tool_use')

    // 第二轮：回灌 tool_result，模型必须终止循环并引用结果
    const r2 = (await p.chat({
      system: '',
      messages: [
        user('@tool get_time {"tz":"utc"}'),
        { role: 'assistant', content: [tu!] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: (tu as { id: string }).id, content: '12:00' }] },
      ],
      tools: TOOLS,
      stream: false,
    })) as LlmChatResponse
    expect(r2.stopReason).toBe('end_turn')
    const text = r2.content.find((b) => b.type === 'text')
    expect(text && 'text' in text ? text.text : '').toContain('12:00')
  })

  it('MUST: system prompt 影响回复内容', async () => {
    const p = createProvider('main')
    const withSys = (await p.chat({ system: 'echo-system:喵喵前缀', messages: [user('echo:正文')], stream: false })) as LlmChatResponse
    const noSys = (await p.chat({ system: '', messages: [user('echo:正文')], stream: false })) as LlmChatResponse
    const t = (r: LlmChatResponse) => { const b = r.content.find((x) => x.type === 'text'); return b && 'text' in b ? b.text : '' }
    expect(t(withSys)).toContain('喵喵前缀')
    expect(t(withSys)).not.toBe(t(noSys))
  })

  it('MUST: maxTokens 被尊重', async () => {
    const p = createProvider('main')
    const res = (await p.chat({
      system: '', messages: [user('echo:这是一段远超三个token的很长很长的回复内容')], stream: false, maxTokens: 3,
    })) as LlmChatResponse
    expect(res.usage.out).toBeLessThanOrEqual(3)
  })

  it('MUST: 限流报错分类为 RATE_LIMIT', async () => {
    const p = createProvider('main')
    await expect(p.chat({ system: '', messages: [user('trigger:RATE_LIMIT')], stream: false }) as Promise<LlmChatResponse>)
      .rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('MUST: 上下文窗口 ≥32K', async () => {
    const p = createProvider('main')
    // mock 估算口径 1 token≈2 字符 → 64K 字符 ≈ 32K token 输入必须能吃下
    const big = 'a'.repeat(64_000)
    const res = (await p.chat({ system: '', messages: [user(`${big} echo:ok`)], stream: false })) as LlmChatResponse
    expect(res.usage.in).toBeGreaterThanOrEqual(32_000)
  })

  // 出处：v2.1 §2.1.1 能力契约表 MUST 行「错误分类 RATE_LIMIT/TIMEOUT/CONTENT_FILTER/UPSTREAM」
  // + v3.0 §3.2「错误分类四码必须可区分」；原文测试清单不足 8 条 MUST，按此语义补齐
  it('MUST: 错误分类四码可区分（TIMEOUT / CONTENT_FILTER / UPSTREAM 与 RATE_LIMIT 互异）', async () => {
    const p = createProvider('main')
    const codes: string[] = []
    for (const code of ['TIMEOUT', 'CONTENT_FILTER', 'UPSTREAM'] as const) {
      try {
        await (p.chat({ system: '', messages: [user(`trigger:${code}`)], stream: false }) as Promise<LlmChatResponse>)
        expect.unreachable(`trigger:${code} 应当抛错`)
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        codes.push((e as ProviderError).code)
      }
    }
    expect(codes).toEqual(['TIMEOUT', 'CONTENT_FILTER', 'UPSTREAM'])
    expect(new Set([...codes, 'RATE_LIMIT']).size).toBe(4)   // 四码互异
  })

  it('SHOULD: cheap 档 200-token 摘要 <1s', async () => {
    const p = createProvider('cheap')
    const start = Date.now()
    const res = (await p.chat({
      system: '', messages: [user('echo:摘要目标文本'.repeat(10))], stream: false, maxTokens: 200,
    })) as LlmChatResponse
    expect(Date.now() - start).toBeLessThan(1000)
    expect(res.usage.out).toBeLessThanOrEqual(200)
  })
})

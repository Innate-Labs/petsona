// OpenAI 兼容 Provider（DeepSeek / 任何 chat.completions 兼容端点）
// 硬约束：不用 vendor SDK，直接 fetch 上游 HTTP API（结构性 lint 天然满足）。

import type { LlmChatResponse } from '@petsona/shared'
import { env } from '../env.js'
import {
  ProviderError, classifyFetchError, classifyHttpStatus,
  type LLMProvider, type ProviderChatRequest, type ProviderChunk,
} from './provider.js'
import { parseSse } from './sse.js'
import { fromOaiMessage, safeJson, toOaiMessages, toOaiTools, toStopReason, type OaiToolCall } from './openai_convert.js'

export type OpenAICompatOpts = { baseUrl: string; apiKey: string; model: string; label: string }

export class OpenAICompatProvider implements LLMProvider {
  private readonly opts: OpenAICompatOpts

  constructor(opts: OpenAICompatOpts) {
    // 未配 key 时抛错——由工厂 catch 后回落 mock（任务约定）
    if (!opts.apiKey) throw new Error(`OpenAICompatProvider(${opts.label}) 缺少 API key`)
    if (!opts.model) throw new Error(`OpenAICompatProvider(${opts.label}) 缺少 model`)
    this.opts = { ...opts, baseUrl: opts.baseUrl.replace(/\/$/, '') }
  }

  chat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> | Promise<LlmChatResponse> {
    return req.stream ? this.streamChat(req) : this.onceChat(req)
  }

  private async post(req: ProviderChatRequest, stream: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: toOaiMessages(req.system, req.messages),
      stream,
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    }
    const tools = toOaiTools(req.tools)
    if (tools) body.tools = tools
    // 为什么带 stream_options：兼容端点（含 DeepSeek）按 OpenAI 惯例在末帧回 usage，供记账
    if (stream) body.stream_options = { include_usage: true }

    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.llmTimeoutMs()),
      })
    } catch (e) {
      throw classifyFetchError(e)
    }
    if (!res.ok) throw classifyHttpStatus(res.status, await res.text().catch(() => ''))
    return res
  }

  private async onceChat(req: ProviderChatRequest): Promise<LlmChatResponse> {
    const res = await this.post(req, false)
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null; tool_calls?: OaiToolCall[] }; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } | null
    const choice = json?.choices?.[0]
    if (!choice?.message) throw new ProviderError('UPSTREAM', '上游返回结构异常（无 choices[0].message）')
    if (choice.finish_reason === 'content_filter') throw new ProviderError('CONTENT_FILTER', '内容被上游安全策略拦截')
    return {
      content: fromOaiMessage(choice.message),
      stopReason: toStopReason(choice.finish_reason),
      usage: { in: json?.usage?.prompt_tokens ?? 0, out: json?.usage?.completion_tokens ?? 0 },
    }
  }

  private async *streamChat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> {
    const res = await this.post(req, true)
    if (!res.body) throw new ProviderError('UPSTREAM', '上游未返回流')

    // tool_calls 增量按 index 聚合（OpenAI 流式协议：arguments 分片下发，结束后才是完整 JSON）
    const calls = new Map<number, { id: string; name: string; args: string }>()
    let finish: string | null | undefined
    let usage = { in: 0, out: 0 }
    let outChars = 0

    try {
      for await (const frame of parseSse(res.body)) {
        if (frame.data === '[DONE]') break
        const chunk = safeJson(frame.data) as {
          choices?: { delta?: { content?: string | null; tool_calls?: (Partial<OaiToolCall> & { index: number; function?: { name?: string; arguments?: string } })[] }; finish_reason?: string | null }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null
        }
        if (chunk.usage) usage = { in: chunk.usage.prompt_tokens ?? 0, out: chunk.usage.completion_tokens ?? 0 }
        const choice = chunk.choices?.[0]
        if (!choice) continue
        if (choice.finish_reason) finish = choice.finish_reason
        const delta = choice.delta
        if (delta?.content) {
          outChars += delta.content.length
          yield { type: 'delta', text: delta.content }
        }
        for (const tc of delta?.tool_calls ?? []) {
          const slot = calls.get(tc.index) ?? { id: '', name: '', args: '' }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.name += tc.function.name
          if (tc.function?.arguments) slot.args += tc.function.arguments
          calls.set(tc.index, slot)
        }
      }
    } catch (e) {
      throw classifyFetchError(e)
    }

    if (finish === 'content_filter') throw new ProviderError('CONTENT_FILTER', '内容被上游安全策略拦截')
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      yield { type: 'tool_use', id: c.id || `tu_${Date.now()}`, name: c.name, input: safeJson(c.args) }
    }
    // 上游没回 usage 时按字符估算兜底（SPEC-GAP: 规格未定估算口径，取 1 token≈2 字符与 mock 一致）
    if (usage.out === 0 && outChars > 0) usage = { ...usage, out: Math.ceil(outChars / 2) }
    yield { type: 'done', stopReason: calls.size ? 'tool_use' : toStopReason(finish), usage }
  }
}

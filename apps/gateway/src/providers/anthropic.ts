// Anthropic 原生 Provider（可精简实现，但四码错误分类必须齐——v3.0 §3.2 硬约束）
// 契约消息本身就是 Anthropic-style，转换成本最低：messages/tools 基本透传。

import type { LlmChatResponse, LlmContentBlock } from '@petsona/shared'
import { env, envStr } from '../env.js'
import {
  ProviderError, classifyFetchError, classifyHttpStatus,
  type LLMProvider, type ProviderChatRequest, type ProviderChunk,
} from './provider.js'
import { parseSse } from './sse.js'
import { safeJson } from './openai_convert.js'

export type AnthropicOpts = { apiKey: string; model: string; baseUrl?: string }

export class AnthropicProvider implements LLMProvider {
  private readonly opts: Required<AnthropicOpts>

  constructor(opts: AnthropicOpts) {
    if (!opts.apiKey) throw new Error('AnthropicProvider 缺少 ANTHROPIC_API_KEY')
    if (!opts.model) throw new Error('AnthropicProvider 缺少 model')
    this.opts = {
      apiKey: opts.apiKey,
      model: opts.model,
      baseUrl: (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, ''),
    }
  }

  chat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> | Promise<LlmChatResponse> {
    return req.stream ? this.streamChat(req) : this.onceChat(req)
  }

  private async post(req: ProviderChatRequest, stream: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      max_tokens: req.maxTokens ?? 4096,   // Anthropic API 必填；SPEC-GAP: 缺省取 4096
      messages: req.messages,
      stream,
    }
    if (req.system) body.system = req.system
    if (req.tools?.length) body.tools = req.tools   // shared LlmToolDef 即 Anthropic tool 格式
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': envStr('ANTHROPIC_VERSION', '2023-06-01'),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.llmTimeoutMs()),
      })
    } catch (e) {
      throw classifyFetchError(e)
    }
    if (!res.ok) throw classifyHttpStatus(res.status, await res.text().catch(() => ''))
    return res
  }

  private mapStop(reason: string | null | undefined): 'end_turn' | 'tool_use' {
    return reason === 'tool_use' ? 'tool_use' : 'end_turn'   // max_tokens/stop_sequence 归 end_turn
  }

  private async onceChat(req: ProviderChatRequest): Promise<LlmChatResponse> {
    const res = await this.post(req, false)
    const json = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[]
      stop_reason?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    } | null
    if (!json?.content) throw new ProviderError('UPSTREAM', '上游返回结构异常（无 content）')
    if (json.stop_reason === 'refusal') throw new ProviderError('CONTENT_FILTER', '内容被上游安全策略拦截')
    const content: LlmContentBlock[] = []
    for (const b of json.content) {
      if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text })
      if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: b.input ?? {} })
    }
    return {
      content,
      stopReason: this.mapStop(json.stop_reason),
      usage: { in: json.usage?.input_tokens ?? 0, out: json.usage?.output_tokens ?? 0 },
    }
  }

  private async *streamChat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> {
    const res = await this.post(req, true)
    if (!res.body) throw new ProviderError('UPSTREAM', '上游未返回流')

    // content_block_start(tool_use) + input_json_delta 分片聚合，block stop 时吐完整 tool_use 帧
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>()
    let stopReason: string | undefined
    let usage = { in: 0, out: 0 }

    try {
      for await (const frame of parseSse(res.body)) {
        const ev = safeJson(frame.data) as Record<string, any>
        switch (frame.event || ev.type) {
          case 'message_start':
            usage.in = ev.message?.usage?.input_tokens ?? 0
            break
          case 'content_block_start':
            if (ev.content_block?.type === 'tool_use') {
              toolBlocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' })
            }
            break
          case 'content_block_delta':
            if (ev.delta?.type === 'text_delta' && ev.delta.text) yield { type: 'delta', text: ev.delta.text }
            if (ev.delta?.type === 'input_json_delta') {
              const slot = toolBlocks.get(ev.index)
              if (slot) slot.json += ev.delta.partial_json ?? ''
            }
            break
          case 'content_block_stop': {
            const slot = toolBlocks.get(ev.index)
            if (slot) {
              yield { type: 'tool_use', id: slot.id, name: slot.name, input: safeJson(slot.json) }
              toolBlocks.delete(ev.index)
            }
            break
          }
          case 'message_delta':
            stopReason = ev.delta?.stop_reason ?? stopReason
            usage.out = ev.usage?.output_tokens ?? usage.out
            break
          case 'error':
            // 上游流内错误事件（如 overloaded_error）→ 四码分类
            throw ev.error?.type === 'rate_limit_error'
              ? new ProviderError('RATE_LIMIT', ev.error?.message ?? '上游限流')
              : new ProviderError('UPSTREAM', ev.error?.message ?? '上游流错误')
        }
      }
    } catch (e) {
      throw classifyFetchError(e)
    }

    if (stopReason === 'refusal') throw new ProviderError('CONTENT_FILTER', '内容被上游安全策略拦截')
    yield { type: 'done', stopReason: this.mapStop(stopReason), usage }
  }
}

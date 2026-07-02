// LLMProvider 抽象层（v2.1 §2.1.1 原样移植，orchestrator/路由唯一依赖）
// 能力契约 MUST：非流式 chat、流式 chat（首字 ≤2s）、Tool Use、system 一等公民、
// 上下文 ≥32K、错误分类四码 RATE_LIMIT/TIMEOUT/CONTENT_FILTER/UPSTREAM 可区分。

import type { LlmChatResponse, LlmMessage, LlmToolDef, LlmSseError } from '@petsona/shared'

export type ProviderErrorCode = LlmSseError['code']   // 'RATE_LIMIT' | 'TIMEOUT' | 'CONTENT_FILTER' | 'UPSTREAM'

// 为什么用自定义 Error 而不是裸 code 返回值：provider 内部任何一层（fetch/解析/上游状态码）
// 都可能失败，异常通道能穿透 async generator，路由层统一 catch 后映射 SSE error 帧或 HTTP 状态。
export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  constructor(code: ProviderErrorCode, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

// 流式产出的帧（与 shared/llm.ts SSE 四帧一一对应；error 走异常通道不占帧位）
export type ProviderChunk =
  | { type: 'delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use'; usage: { in: number; out: number } }

export type ProviderChatRequest = {
  system: string
  messages: LlmMessage[]
  tools?: LlmToolDef[]
  stream: boolean
  maxTokens?: number
}

// v2.1 原文签名：chat(req) → AsyncIterable<Chunk> | Promise<Response>，调用方按 req.stream 分流
export interface LLMProvider {
  chat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> | Promise<LlmChatResponse>
}

// 上游 HTTP 状态 → 四码分类（openai_compat / anthropic 共用；mock 不走 HTTP）
export function classifyHttpStatus(status: number, body: string): ProviderError {
  if (status === 429) return new ProviderError('RATE_LIMIT', `上游限流（${status}）`)
  if (status === 408 || status === 504) return new ProviderError('TIMEOUT', `上游超时（${status}）`)
  // SPEC-GAP: 规格未定义内容过滤的识别方式，按上游 body 关键词识别（OpenAI/Anthropic 惯例）
  if (/content_filter|content policy|harmful|refusal/i.test(body)) {
    return new ProviderError('CONTENT_FILTER', '内容被上游安全策略拦截')
  }
  return new ProviderError('UPSTREAM', `上游错误（${status}）：${body.slice(0, 200)}`)
}

// fetch 异常 → 四码（AbortError = 超时）
export function classifyFetchError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
    return new ProviderError('TIMEOUT', '上游请求超时')
  }
  return new ProviderError('UPSTREAM', e instanceof Error ? e.message : String(e))
}

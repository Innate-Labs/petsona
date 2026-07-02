// §3.2 云网关协议类型（/v1/llm/chat 请求与 SSE 帧）
// SPEC-GAP: §2.2 shared 清单未列 llm.ts，但网关协议为壳/harness/网关共享契约，归入 shared

import type { JSONSchema } from './tool.js'

export type LlmTier = 'main' | 'cheap'          // 对应 LLM_MAIN / LLM_CHEAP（继承 v2.1 §2.1.1）
export type LlmLoop = 'companion' | 'subagent' | 'memory' | 'proactive'

// Anthropic-style 消息块
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export type LlmMessage = {
  role: 'user' | 'assistant'
  content: string | LlmContentBlock[]
}

export type LlmToolDef = {
  name: string
  description: string
  input_schema: JSONSchema
}

export type LlmChatRequest = {
  tier: LlmTier
  system: string
  messages: LlmMessage[]
  tools?: LlmToolDef[]
  stream: boolean
  maxTokens: number
  meta: { loop: LlmLoop; taskId?: string }     // 记账与看板归因
}

// SSE 四事件帧
export type LlmSseDelta = { text: string }
export type LlmSseToolUse = { id: string; name: string; input: unknown }
export type LlmSseDone = {
  stopReason: 'end_turn' | 'tool_use'
  usage: { in: number; out: number }
}
export type LlmSseError = {
  code: 'RATE_LIMIT' | 'TIMEOUT' | 'CONTENT_FILTER' | 'UPSTREAM'
  message: string
}

// stream=false 一次性 JSON
export type LlmChatResponse = {
  content: LlmContentBlock[]
  stopReason: LlmSseDone['stopReason']
  usage: LlmSseDone['usage']
}

// /v1/memory/sync
export type MemorySyncPush = { items: unknown[]; deviceId: string }
export type MemorySyncPushRes = { accepted: number; serverTime: number }
export type MemorySyncPull = { since: number }
export type MemorySyncPullRes = { items: unknown[]; serverTime: number }

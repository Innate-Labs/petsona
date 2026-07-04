// Anthropic-style messages（shared/llm.ts 契约）⇄ OpenAI chat.completions 双向转换
// 为什么放独立文件：转换是纯函数、与 HTTP 无关，拆开让 openai_compat.ts 保持 ≤300 行且可单测。

import type { LlmContentBlock, LlmMessage, LlmToolDef, LlmChatResponse } from '@petsona/shared'

// —— OpenAI 侧类型（只声明用到的子集，不引 vendor SDK）——
export type OaiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type OaiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type OaiTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

// Anthropic-style → OpenAI messages（system 单列为首条 system message）
export function toOaiMessages(system: string, messages: LlmMessage[]): OaiMessage[] {
  const out: OaiMessage[] = []
  if (system) out.push({ role: 'system', content: system })

  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      // assistant 块：text 合并为 content，tool_use 转 tool_calls
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
      const calls: OaiToolCall[] = m.content
        .filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      // user 块：tool_result 拆成独立 role=tool 消息（OpenAI 协议要求），text 保留为 user 消息
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content })
        } else if (b.type === 'text' && b.text) {
          out.push({ role: 'user', content: b.text })
        }
      }
    }
  }
  return out
}

export function toOaiTools(tools?: LlmToolDef[]): OaiTool[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

// OpenAI finish_reason → 契约 stopReason（其余 length/stop 等一律归 end_turn）
export function toStopReason(finish: string | null | undefined): LlmChatResponse['stopReason'] {
  return finish === 'tool_calls' ? 'tool_use' : 'end_turn'
}

// OpenAI 非流式 choice.message → 契约 content 块
// SPEC-GAP: reasoning_content 是 DeepSeek R1 / v4-flash 非标扩展字段，OpenAI 官方无此键；
// 有值时前置 reasoning 块，纯 text 模型走原路径不受影响
export function fromOaiMessage(msg: {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: OaiToolCall[]
}): LlmContentBlock[] {
  const blocks: LlmContentBlock[] = []
  if (msg.reasoning_content) blocks.push({ type: 'reasoning', text: msg.reasoning_content })
  if (msg.content) blocks.push({ type: 'text', text: msg.content })
  for (const c of msg.tool_calls ?? []) {
    blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input: safeJson(c.function.arguments) })
  }
  return blocks
}

export function safeJson(s: string): unknown {
  try { return JSON.parse(s || '{}') } catch { return { _raw: s } }
}

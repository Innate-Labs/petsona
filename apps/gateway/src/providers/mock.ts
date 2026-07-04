// MockLLMProvider —— 开发/测试真源（未配 key 时工厂回落到这里）
// 为什么 mock 要有「可观测行为」（echo/@tool/trigger）：合规测试 8 条 MUST（v2.1 §2.1.1）
// 需要验证 system 生效、maxTokens 被尊重、四码错误可区分，mock 必须提供确定性钩子。

import type { LlmChatResponse, LlmContentBlock, LlmMessage } from '@petsona/shared'
import { ProviderError, type LLMProvider, type ProviderChatRequest, type ProviderChunk } from './provider.js'

const REPLY_POOL = ['今天也一起加油喵～', '我在呢，想聊点什么？', '收到收到，交给我吧！'] as const
const STREAM_CHARS_PER_FRAME = 20   // 任务约定：流式约 20 字符/帧

// mock 的 token 估算：1 token ≈ 2 字符（不追求精确，只需 usage 单调、maxTokens 可观测）
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 2)
}

function textOf(content: LlmMessage['content']): string {
  if (typeof content === 'string') return content
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

function hasToolResult(m: LlmMessage | undefined): boolean {
  return !!m && typeof m.content !== 'string' && m.content.some((b) => b.type === 'tool_result')
}

export class MockLLMProvider implements LLMProvider {
  private replyCursor = 0
  private toolUseSeq = 0

  chat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> | Promise<LlmChatResponse> {
    return req.stream ? this.streamChat(req) : this.onceChat(req)
  }

  // —— 决策核心：根据输入决定回复文本 / tool_use ——
  private plan(req: ProviderChatRequest): {
    text: string
    toolUse?: { id: string; name: string; input: unknown }
  } {
    const last = req.messages[req.messages.length - 1]
    const userText = textOf(last?.content ?? '')

    // 四码错误触发钩子（合规测试「错误分类可区分」用）
    const trig = /trigger:(RATE_LIMIT|TIMEOUT|CONTENT_FILTER|UPSTREAM)/.exec(userText)
    if (trig) throw new ProviderError(trig[1] as ProviderError['code'], `mock 触发 ${trig[1]}`)

    // @tool <name> <json>：产出 tool_use（联调轻工具用；要求请求确实带 tools）
    // 为什么不在这里早退：echo-system/maxTokens 等文本管线仍要生效（SSE 联调需要 delta+tool_use 同帧序列）
    let toolUse: { id: string; name: string; input: unknown } | undefined
    const toolMatch = /@tool\s+(\S+)\s+(\{.*\})/s.exec(userText)
    if (toolMatch && req.tools?.length) {
      let input: unknown = {}
      try { input = JSON.parse(toolMatch[2] ?? '{}') } catch { input = { _raw: toolMatch[2] } }
      toolUse = { id: `tu_${++this.toolUseSeq}`, name: toolMatch[1] ?? 'unknown', input }
    }

    let text: string
    if (toolUse) {
      text = ''
    } else if (hasToolResult(last)) {
      // 上一步是 tool_result → 终止工具循环，回带结果（MUST「Tool Use 循环终止」）
      const blocks = last!.content as Extract<LlmMessage['content'], unknown[]>
      const result = blocks.find((b) => b.type === 'tool_result')
      const gist = result && result.type === 'tool_result' ? result.content.slice(0, 30) : ''
      text = `工具结果收到：${gist}`
    } else if (userText.includes('echo:')) {
      text = userText.slice(userText.indexOf('echo:') + 5).trim()
    } else {
      text = REPLY_POOL[this.replyCursor++ % REPLY_POOL.length]!
    }

    // system 一等公民：echo-system: 指令让 system 内容可观测地进入回复（MUST「system 影响回复」）
    const sysMatch = /echo-system:(\S+)/.exec(req.system)
    if (sysMatch) text = `${sysMatch[1]}${text}`

    // maxTokens 被尊重：按 mock 估算口径截断（1 token≈2 字符）
    if (req.maxTokens !== undefined) text = text.slice(0, req.maxTokens * 2)
    return { text, toolUse }
  }

  private usageOf(req: ProviderChatRequest, outText: string): { in: number; out: number } {
    const inChars =
      req.system.length + req.messages.reduce((n, m) => n + textOf(m.content).length, 0)
    return { in: Math.ceil(inChars / 2), out: estimateTokens(outText) }
  }

  private async onceChat(req: ProviderChatRequest): Promise<LlmChatResponse> {
    const { text, toolUse } = this.plan(req)
    const content: LlmContentBlock[] = []
    if (text) content.push({ type: 'text', text })
    if (toolUse) content.push({ type: 'tool_use', ...toolUse })
    return {
      content,
      stopReason: toolUse ? 'tool_use' : 'end_turn',
      usage: this.usageOf(req, text),
    }
  }

  private async *streamChat(req: ProviderChatRequest): AsyncIterable<ProviderChunk> {
    const { text, toolUse } = this.plan(req)
    for (let i = 0; i < text.length; i += STREAM_CHARS_PER_FRAME) {
      yield { type: 'delta', text: text.slice(i, i + STREAM_CHARS_PER_FRAME) }
    }
    if (toolUse) yield { type: 'tool_use', ...toolUse }
    yield {
      type: 'done',
      stopReason: toolUse ? 'tool_use' : 'end_turn',
      usage: this.usageOf(req, text),
    }
  }
}

// POST /v1/llm/chat（v3.0 §3.2：带治理的 LLM 透传——鉴权→限流→预算熔断→Provider→用量记账）
// 网关不做意图路由/技能/人格（全部本地化），也不信客户端上报的任何额度。

import type { FastifyInstance, FastifyReply } from 'fastify'
import type { LlmChatRequest, LlmChatResponse } from '@petsona/shared'
import { errBody } from '../lib/http.js'
import { requireUser } from '../auth/jwt.js'
import { checkAndCountChat, checkDailyBudget, checkTaskBudget, recordUsage } from '../governance.js'
import { createProvider } from '../providers/factory.js'
import { ProviderError, type ProviderChunk } from '../providers/provider.js'

// ProviderError 四码 → HTTP 状态（SPEC-GAP: 规格只定义 SSE error 帧的四码，
// 非流式路径的状态码按 HTTP 语义映射：限流 429 / 超时 504 / 内容拦截 422 / 上游 502）
const CODE_STATUS: Record<ProviderError['code'], number> = {
  RATE_LIMIT: 429,
  TIMEOUT: 504,
  CONTENT_FILTER: 422,
  UPSTREAM: 502,
}

function validate(body: unknown): { ok: true; req: LlmChatRequest } | { ok: false; msg: string } {
  const b = body as Partial<LlmChatRequest> | null
  if (!b || typeof b !== 'object') return { ok: false, msg: '请求体必须是 JSON 对象' }
  if (b.tier !== 'main' && b.tier !== 'cheap') return { ok: false, msg: 'tier 必须是 main|cheap' }
  if (!Array.isArray(b.messages) || b.messages.length === 0) return { ok: false, msg: 'messages 不能为空' }
  if (typeof b.stream !== 'boolean') return { ok: false, msg: 'stream 必须是布尔' }
  if (typeof b.maxTokens !== 'number' || b.maxTokens <= 0) return { ok: false, msg: 'maxTokens 必须是正数' }
  const loop = b.meta?.loop
  if (!loop || !['companion', 'subagent', 'memory', 'proactive'].includes(loop)) {
    return { ok: false, msg: 'meta.loop 必须是 companion|subagent|memory|proactive' }
  }
  return { ok: true, req: { ...b, system: b.system ?? '' } as LlmChatRequest }
}

function sseWrite(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function streamOut(reply: FastifyReply, iter: AsyncIterable<ProviderChunk>, taskId?: string): Promise<void> {
  // hijack 后自己管响应；把 CORS 等已排队的 header 一并带上（hijack 会绕过 fastify 的 header 输出）
  reply.hijack()
  reply.raw.writeHead(200, {
    ...(reply.getHeaders() as import('node:http').OutgoingHttpHeaders),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  try {
    for await (const chunk of iter) {
      if (chunk.type === 'delta') sseWrite(reply, 'delta', { text: chunk.text })
      // SPEC-GAP: reasoning 帧不记账（DeepSeek 上游 usage 只在末帧统计正文 completion_tokens）
      else if (chunk.type === 'reasoning') sseWrite(reply, 'reasoning', { text: chunk.text })
      else if (chunk.type === 'tool_use') sseWrite(reply, 'tool_use', { id: chunk.id, name: chunk.name, input: chunk.input })
      else {
        recordUsage(chunk.usage, taskId)   // done 帧记账（导出到 ledger，供限流/预算共用）
        sseWrite(reply, 'done', { stopReason: chunk.stopReason, usage: chunk.usage })
      }
    }
  } catch (e) {
    // SSE 已开流，错误只能走 error 帧（v3.0 §3.2 第四帧）
    const pe = e instanceof ProviderError ? e : new ProviderError('UPSTREAM', e instanceof Error ? e.message : String(e))
    sseWrite(reply, 'error', { code: pe.code, message: pe.message })
  } finally {
    reply.raw.end()
  }
}

export function registerLlmRoutes(app: FastifyInstance): void {
  app.post('/v1/llm/chat', async (req, reply) => {
    // ① 鉴权
    const auth = requireUser(req)
    if (!auth) return reply.code(401).send(errBody('UNAUTHENTICATED', '请先登录'))

    // ② 请求校验
    const v = validate(req.body)
    if (!v.ok) return reply.code(400).send(errBody('BAD_REQUEST', v.msg))
    const body = v.req

    // ③ 限流（rate:chat:min|day:{userId}）
    const rate = checkAndCountChat(auth.sub)
    if (!rate.ok) {
      const msg = rate.reason === 'min' ? '说话太快啦，一分钟后再试' : '今天聊得够多了，明天再来吧'
      return reply.code(429).send(errBody('RATE_LIMIT', msg))
    }

    // ④ 日预算熔断（budget:daily:usd）
    // SPEC-GAP: 规格未给预算熔断的错误码，四码里语义最近的是 RATE_LIMIT（客户端兜底策略一致）
    if (!checkDailyBudget()) {
      return reply.code(429).send(errBody('RATE_LIMIT', '今日预算已用完，明天再来吧'))
    }

    // ⑤ 子任务预算（meta.loop=subagent 按 taskId 累计；阈值随 meta 上报、以网关 TASK_MAX_TOKENS 封顶）
    if (body.meta.loop === 'subagent' && body.meta.taskId) {
      const requested = (body.meta as { taskBudget?: { maxTokens?: number } }).taskBudget?.maxTokens
      const tb = checkTaskBudget(body.meta.taskId, requested)
      if (!tb.ok) {
        return reply.code(402).send(
          errBody('TASK_BUDGET_EXCEEDED', `任务 token 预算已用完（${tb.used}/${tb.limit}）`),
        )
      }
    }

    // ⑥ 调 Provider（tier 双档；缺 key 工厂已回落 mock）
    // BYOK：客户端在 Keychain 存了自己的 LLM key 时，harness 把它作为 header 透传，
    // 网关仅当此请求使用（不缓存 provider 实例，防跨请求泄漏）
    const userKey = req.headers['x-petsona-user-llm-key']
    const apiKeyOverride = typeof userKey === 'string' && userKey.length > 0 ? userKey : undefined
    const provider = createProvider(body.tier, apiKeyOverride ? { apiKeyOverride } : undefined)
    const call = provider.chat({
      system: body.system,
      messages: body.messages,
      tools: body.tools,
      stream: body.stream,
      maxTokens: body.maxTokens,
    })

    if (body.stream) {
      await streamOut(reply, call as AsyncIterable<ProviderChunk>, body.meta.taskId)
      return
    }

    try {
      const res = (await call) as LlmChatResponse
      recordUsage(res.usage, body.meta.taskId)
      return reply.send(res)   // {content, stopReason, usage}
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('UPSTREAM', e instanceof Error ? e.message : String(e))
      return reply.code(CODE_STATUS[pe.code]).send(errBody(pe.code, pe.message))
    }
  })
}

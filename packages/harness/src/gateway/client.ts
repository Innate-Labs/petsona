// 缝①：云端唯一出口——harness 其余代码不得发任何外网请求（§1 四道缝）
// 结构性约束单测扫描 fetch/axios 只允许出现在本文件

import type {
  Config, ErrCode, LlmChatRequest, LlmChatResponse, LlmSseDone, LlmSseError, LlmSseToolUse,
  MemorySyncPush, MemorySyncPushRes, MemorySyncPull, MemorySyncPullRes, TrackEvent,
} from '@petsona/shared'
// LlmSseReasoning 只用作 onReasoning 契约文档；实际 dispatch 用运行时字符串判断，
// 未定义 payload 类型时消费端安全丢弃
import { keychainDelete, keychainGet, keychainSet } from './keychain.js'

const ACCESS_ACCOUNT = 'accessToken'
const REFRESH_ACCOUNT = 'refreshToken'
// BYOK：用户自带 LLM key 也进 Keychain，与 auth token 同 service（dev.petsona.app）不同 account
const USER_LLM_KEY_ACCOUNT = 'userLlmApiKey'

export class GatewayError extends Error {
  constructor(public code: ErrCode, message: string) {
    super(message)
  }
}

export type ChatStreamCallbacks = {
  onDelta: (text: string) => void
  // SPEC-GAP: reasoning 类模型（DeepSeek R1/v4-flash）的思考流；非 reasoning 模型永远不回调
  onReasoning?: (text: string) => void
  onToolUse?: (tu: LlmSseToolUse) => void
  onDone: (done: LlmSseDone) => void
  onError: (err: LlmSseError) => void
}

export type AuthTokens = { accessToken: string; refreshToken?: string }

export class GatewayClient {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  // 用户自带 LLM key 内存缓存，避免每次请求都 spawn security CLI；startup 从 Keychain 载入
  private userLlmApiKey: string | null = null
  private llmDebug: Config['llmDebug'] | null = null

  constructor(private baseUrl: string) {}

  setBaseUrl(url: string): void { this.baseUrl = url }
  setLlmDebugConfig(config: Config['llmDebug']): void {
    this.llmDebug = {
      provider: config.provider,
      baseUrl: config.baseUrl.trim().replace(/\/$/, ''),
      model: normalizeModel(config.model),
    }
  }

  // ---------- 凭证（内存 + Keychain，永不落磁盘） ----------

  async loadTokens(): Promise<boolean> {
    this.accessToken = await keychainGet(ACCESS_ACCOUNT)
    this.refreshToken = await keychainGet(REFRESH_ACCOUNT)
    return this.accessToken !== null
  }

  async saveTokens(tokens: AuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken
    await keychainSet(ACCESS_ACCOUNT, tokens.accessToken)
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken
      await keychainSet(REFRESH_ACCOUNT, tokens.refreshToken)
    }
  }

  async clearTokens(): Promise<void> {
    this.accessToken = null
    this.refreshToken = null
    await keychainDelete(ACCESS_ACCOUNT)
    await keychainDelete(REFRESH_ACCOUNT)
  }

  get isAuthenticated(): boolean { return this.accessToken !== null }

  // ---------- BYOK：用户自带 LLM key（Keychain 存/内存缓存，chat 请求带 header）----------

  async loadUserLlmApiKey(): Promise<void> {
    this.userLlmApiKey = await keychainGet(USER_LLM_KEY_ACCOUNT)
  }

  async setUserLlmApiKey(key: string): Promise<void> {
    // 空串等价于清除；否则落盘 Keychain + 更新内存缓存
    const trimmed = key.trim()
    if (!trimmed) { await this.clearUserLlmApiKey(); return }
    this.userLlmApiKey = trimmed
    await keychainSet(USER_LLM_KEY_ACCOUNT, trimmed)
  }

  async clearUserLlmApiKey(): Promise<void> {
    this.userLlmApiKey = null
    await keychainDelete(USER_LLM_KEY_ACCOUNT)
  }

  /** 只回是否已设置 + 末四位掩码，永不回明文（防日志/截屏泄露） */
  getUserLlmApiKeyMeta(): { hasKey: boolean; maskedTail?: string } {
    if (!this.userLlmApiKey) return { hasKey: false }
    return { hasKey: true, maskedTail: this.userLlmApiKey.slice(-4) }
  }

  async testUserLlmConnection(apiKeyDraft?: string | null): Promise<{ ok: boolean; message: string }> {
    const previous = this.userLlmApiKey
    const draft = apiKeyDraft?.trim()
    if (draft) this.userLlmApiKey = draft
    if (!this.userLlmApiKey) throw new GatewayError('BAD_REQUEST', '请输入 API Key 后再测试连接')
    if (!this.llmDebug?.baseUrl) throw new GatewayError('BAD_REQUEST', 'Base URL 不能为空')
    if (!this.llmDebug?.model) throw new GatewayError('BAD_REQUEST', 'Model 不能为空')
    try {
      await this.chatOnce({
        tier: 'main',
        system: '',
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        maxTokens: 8,
        meta: { loop: 'companion' },
      })
      return { ok: true, message: '连接成功' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new GatewayError('UPSTREAM', `连接失败：${message}`)
    } finally {
      if (draft) this.userLlmApiKey = previous
    }
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {}
    if (json) h['content-type'] = 'application/json'
    if (this.accessToken) h['authorization'] = `Bearer ${this.accessToken}`
    // BYOK header：只在 chat 请求带（headers() 通用；其它端点带上 gateway 也会忽略，无副作用）
    if (this.userLlmApiKey) {
      h['x-petsona-user-llm-key'] = this.userLlmApiKey
      if (this.llmDebug?.provider) h['x-petsona-llm-provider'] = this.llmDebug.provider
      if (this.llmDebug?.baseUrl) h['x-petsona-llm-base-url'] = this.llmDebug.baseUrl
      if (this.llmDebug?.model) h['x-petsona-llm-model'] = this.llmDebug.model
    }
    return h
  }

  // ---------- /v1/auth/*（继承 v2.1 §3.3；桌面差异 aud=petsona-desktop） ----------

  async requestCode(email: string): Promise<{ ok: boolean; ttlSec?: number }> {
    return this.postJson('/v1/auth/request-code', { email })
  }

  async submitCode(email: string, code: string): Promise<AuthTokens & { email: string }> {
    // 网关路由是 /v1/auth/login（继承 v2.1 §3.3.4），email 在 user 里而非顶层
    const res = await this.postJson<AuthTokens & { user: { id: string; email: string } }>(
      '/v1/auth/login', { email, code },
    )
    await this.saveTokens(res)
    return { ...res, email: res.user?.email ?? email }
  }

  /** 密码路径：首次登录即注册（网关侧不存在 user 时创建 + 写 hash） */
  async submitPassword(email: string, password: string): Promise<AuthTokens & { email: string }> {
    const res = await this.postJson<AuthTokens & { user: { id: string; email: string } }>(
      '/v1/auth/login', { email, password },
    )
    await this.saveTokens(res)
    return { ...res, email: res.user?.email ?? email }
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false
    try {
      const res = await this.postJson<AuthTokens>('/v1/auth/refresh', { refreshToken: this.refreshToken })
      await this.saveTokens(res)
      return true
    } catch {
      return false
    }
  }

  async logout(): Promise<void> {
    try {
      await this.postJson('/v1/auth/logout', { refreshToken: this.refreshToken })
    } catch {
      // 网关不可达也要本地登出
    }
    await this.clearTokens()
  }

  // ---------- POST /v1/llm/chat（SSE 四事件帧） ----------

  async chatStream(req: LlmChatRequest, cb: ChatStreamCallbacks, timeoutMs = 12_000): Promise<void> {
    // 12s 首包超时中断（继承 v2.1 AI 超时兜底）；流建立后由 done/error 帧收尾
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let firstByte = false
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/v1/llm/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ...req, stream: true }),
        signal: ctrl.signal,
      })
      // access TTL 15m，长会话必然过期：401 先拿 refresh 换新再重试一次
      if (response.status === 401 && (await this.refresh())) {
        response = await fetch(`${this.baseUrl}/v1/llm/chat`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ ...req, stream: true }),
          signal: ctrl.signal,
        })
      }
    } catch (err) {
      clearTimeout(timer)
      const code = ctrl.signal.aborted ? 'TIMEOUT' : 'UPSTREAM'
      cb.onError({ code, message: err instanceof Error ? err.message : String(err) })
      return
    }
    if (!response.ok || !response.body) {
      clearTimeout(timer)
      cb.onError({ code: mapHttpToLlmErr(response.status), message: `HTTP ${response.status}` })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let currentEvent = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!firstByte) { firstByte = true; clearTimeout(timer) }
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trimEnd()
          buf = buf.slice(idx + 1)
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            const data = JSON.parse(line.slice(5).trim())
            switch (currentEvent) {
              case 'delta': cb.onDelta(data.text); break
              case 'reasoning': cb.onReasoning?.(data.text); break
              case 'tool_use': cb.onToolUse?.(data); break
              case 'done': cb.onDone(data); return
              case 'error': cb.onError(data); return
            }
          }
        }
      }
      // 流结束但没收到 done/error 帧 = 流式中断
      cb.onError({ code: 'UPSTREAM', message: '流式中断：未收到 done 帧' })
    } catch (err) {
      cb.onError({
        code: ctrl.signal.aborted ? 'TIMEOUT' : 'UPSTREAM',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async chatOnce(req: LlmChatRequest): Promise<LlmChatResponse> {
    return this.postJson('/v1/llm/chat', { ...req, stream: false })
  }

  // ---------- /v1/memory/sync ----------

  async memorySyncPush(body: MemorySyncPush): Promise<MemorySyncPushRes> {
    return this.postJson('/v1/memory/sync', { ...body, mode: 'push' })
  }

  async memorySyncPull(body: MemorySyncPull): Promise<MemorySyncPullRes> {
    return this.postJson('/v1/memory/sync', { ...body, mode: 'pull' })
  }

  // ---------- 埋点批量上报（§9） ----------

  async trackBatch(events: TrackEvent[]): Promise<void> {
    await this.postJson('/v1/track/batch', { events })
  }

  // ---------- POST /v1/proxy/fetch（web_fetch 网关代理，缝①唯一联网出口） ----------

  async proxyFetch(url: string, maxBytes?: number): Promise<{
    ok: boolean
    status: number
    contentType: string
    finalUrl: string
    truncated: boolean
    text: string
  }> {
    return this.postJson('/v1/proxy/fetch', { url, maxBytes })
  }

  // ---------- 内部 ----------

  private async postJson<T>(path: string, body: unknown, retried = false): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new GatewayError('UPSTREAM', `网关不可达: ${err instanceof Error ? err.message : err}`)
    }
    if (response.status === 401) {
      // access TTL 15m，长会话必然过期：401 自动 refresh 后重试一次；
      // /v1/auth/* 排除以免 refresh 自身 401 时递归
      if (!retried && !path.startsWith('/v1/auth/') && this.refreshToken) {
        if (await this.refresh()) return this.postJson<T>(path, body, true)
      }
      throw new GatewayError('UNAUTHENTICATED', '未登录或 token 过期')
    }
    if (response.status === 429) throw new GatewayError('RATE_LIMIT', '触发限流')
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new GatewayError('UPSTREAM', `HTTP ${response.status}: ${readHttpErrorMessage(text)}`)
    }
    return response.json() as Promise<T>
  }
}

function mapHttpToLlmErr(status: number): LlmSseError['code'] {
  if (status === 429) return 'RATE_LIMIT'
  if (status === 408 || status === 504) return 'TIMEOUT'
  return 'UPSTREAM'
}

function normalizeModel(model: string): string {
  const trimmed = model.trim()
  return trimmed.toLowerCase().startsWith('deepseek-') ? trimmed.toLowerCase() : trimmed
}

function readHttpErrorMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string' && body.error.message.trim()) return body.error.message.slice(0, 200)
  } catch {
    // 非 JSON 上游错误直接截断展示
  }
  return text.slice(0, 200)
}

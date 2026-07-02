// stdio NDJSON server 入口——壳 spawn 本进程，stdin 收 Envelope、stdout 发 Envelope
// 装配所有子系统 + 注册 §3.1 全消息表（M1 Gate ④：未用到的返回占位）

import { createInterface } from 'node:readline'
import type { Emotion, Envelope } from '@petsona/shared'
import { IPC, TRACK } from '@petsona/shared'
import { decodeLine, encodeLine, makeEvent } from './ipc/envelope.js'
import { Router, IpcError } from './ipc/router.js'
import { anonUserId, deviceId, resolvePaths } from './paths.js'
import { bootstrapAssets } from './bootstrap.js'
import { ConfigStore } from './config.js'
import { GatewayClient } from './gateway/client.js'
import { SessionsDb } from './memory/sqlite.js'
import { ColdFs } from './memory/coldfs.js'
import { LocalMemoryStore } from './memory/store.js'
import { FallbackPool } from './persona/fallback_pool.js'
import { SkillLoader } from './skills/loader.js'
import { HookPipeline } from './hooks/pipeline.js'
import { injectionGuard } from './hooks/pre/injection_guard.js'
import { makeLocalRate } from './hooks/pre/local_rate.js'
import {
  makePermissionHook, scopeHook, makeAuditHook,
  makePersistLargeHook, stagingRecordHook, progressMirrorHook,
} from './hooks/pre/tooluse.js'
import {
  personaEnforceHook, makeBubbleCompressHook, makeFallbackHook, makeTrackEndHook,
} from './hooks/post/index.js'
import { ToolRegistry } from './tools/registry.js'
import { registerLightTools } from './tools/light/index.js'
import { InjectionQueue } from './loop/injection_queue.js'
import { CompanionLoop } from './loop/companion.js'
import { Tracker } from './telemetry/track.js'
import { join } from 'node:path'

const startedAt = Date.now()

export function createHarness(emitLine: (line: string) => void) {
  const emit = (e: { type: string; payload: unknown }) => {
    // set_emotion 工具向外发信号时，harness 内部情绪镜像同步更新（persona EMOTION_STATE 段依赖）
    if (e.type === IPC.PET_EMOTION_SIGNAL) {
      const p = e.payload as { state?: Emotion; cause?: string }
      if (p?.state) { emotion = p.state; emotionCause = p.cause ?? '' }
    }
    emitLine(encodeLine(makeEvent(e.type, e.payload)))
  }

  // ---- 状态与存储 ----
  const userId = anonUserId()                     // 登录后迁移目录（§2.3）——M1 匿名目录起步，登录仅切换鉴权态
  const paths = resolvePaths(userId)
  bootstrapAssets(paths)
  const config = new ConfigStore(paths)
  const gateway = new GatewayClient(process.env.PETSONA_GATEWAY_URL || config.get().gatewayUrl)
  const db = new SessionsDb(paths.sessionsDb)
  const cold = new ColdFs(paths.coldDir, paths.memoryIndex)
  const store = new LocalMemoryStore(db, cold, gateway)
  const pool = new FallbackPool()
  pool.load(join(paths.root, 'fallback'))
  const skills = new SkillLoader(paths.skills)
  const queue = new InjectionQueue()
  let authState: { loginState: 'anon' | 'logged_in'; email?: string } = { loginState: 'anon' }
  const tracker = new Tracker(gateway, deviceId(), () => authState.email)
  tracker.start()
  const sysState = { accessibility: false, screenRecording: false, automation: {} as Record<string, boolean> }
  let emotion: Emotion = 'calm'
  let emotionCause = 'startup'

  // ---- hooks 管线全挂载（§3.7 固定顺序；M1 部分为 stub 但链路走通） ----
  const hooks = new HookPipeline()
  hooks.onPreTurn('injection_guard', injectionGuard)
  hooks.onPreTurn('local_rate', makeLocalRate(pool))
  hooks.onPreTurn('track_start', async () => { /* 对话_发起在 loop 内带字数埋点，这里保管线位 */ })
  hooks.onPreLLM('memory_assemble', async () => { /* 装配在 loop 内执行（需 triggers/预算上下文），此处保管线位 */ })
  hooks.onPreLLM('injection_drain', async (ctx) => {
    const items = queue.drain()
    if (items.length) {
      ctx.messages.push({ role: 'user', content: items.map((i) => i.content).join('\n') })
    }
  })
  hooks.onPostLLM('persona_enforce', personaEnforceHook)
  hooks.onPostLLM('bubble_compress', makeBubbleCompressHook(gateway))
  hooks.onPostLLM('fallback', makeFallbackHook(pool))
  hooks.onPostLLM('track_end', makeTrackEndHook(tracker))

  const registry = new ToolRegistry('companion')
  hooks.onPreToolUse('permission', makePermissionHook(registry, pool, emit))
  hooks.onPreToolUse('scope', scopeHook)
  hooks.onPreToolUse('audit', makeAuditHook(paths.auditLog, registry))
  hooks.onPostToolUse('persist_large', makePersistLargeHook(paths.outputsDir))
  hooks.onPostToolUse('staging_record', stagingRecordHook)
  hooks.onPostToolUse('progress_mirror', progressMirrorHook)
  hooks.onSubagentStop('result_schema', async () => {
    throw new Error('M2 实现：子 Agent 结果 schema 校验')
  })

  registerLightTools(registry, { store, skills, paths, emit, sysState })

  const loop = new CompanionLoop({
    gateway, store, registry, hooks, queue, pool, tracker, paths, emit,
    getEmotion: () => emotion,
  })

  // ---- 路由：§3.1 全消息表 ----
  const router = new Router((env) => emitLine(encodeLine(env)))

  router.onReq(IPC.PING, async () => ({ ok: true, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) }))

  // 对话类
  router.onReq(IPC.CHAT_SEND, async (p: { text: string }) => {
    if (typeof p?.text !== 'string' || !p.text.trim()) throw new IpcError('BAD_REQUEST', 'text 必填')
    return loop.handleChatSend(p.text)
  })
  router.onReq(IPC.CHAT_HISTORY_GET, async (p: { limit?: number }) => ({
    turns: db.recentTurns(Math.min(p?.limit ?? 50, 200)),
  }))

  // 宠物状态类
  router.onReq(IPC.BUBBLE_ACTION, async () => ({ placeholder: true, note: 'M2 实现（审批气泡回传）' }))

  // 任务与审批类（M2 占位，Gate ④）
  router.onReq(IPC.TASK_LIST_GET, async () => ({ tasks: [] }))
  router.placeholder(IPC.TASK_CANCEL, 'M2')
  router.placeholder(IPC.PLAN_GET, 'M2')
  router.placeholder(IPC.APPROVAL_DECISION, 'M2')
  router.placeholder(IPC.UNDO_REQUEST, 'M2')

  // 提醒类（调度器 M3；SET 走轻工具同款持久化占位）
  router.placeholder(IPC.REMINDER_SET, 'M3')
  router.placeholder(IPC.REMINDER_STOP, 'M3')

  // 记忆类
  router.onReq(IPC.MEMORY_LIST_GET, async (p: { type?: any }) => ({ items: cold.metas(p?.type) }))
  router.onReq(IPC.MEMORY_DELETE, async (p: { name: string }) => {
    if (!cold.remove(String(p?.name ?? ''))) throw new IpcError('BAD_REQUEST', '记忆不存在')
    return { ok: true }
  })
  router.onReq(IPC.MEMORY_EDIT, async (p: { name: string; body?: string }) => {
    const item = cold.read(String(p?.name ?? ''))
    if (!item) throw new IpcError('BAD_REQUEST', '记忆不存在')
    if (item.source !== 'settings') throw new IpcError('PERMISSION_DENIED', 'source≠settings 的记忆只读（§3.1）')
    cold.write({ ...item, body: p.body ?? item.body, lastT: new Date().toISOString() })
    return { ok: true }
  })
  router.onReq(IPC.MEMORY_CLEAR, async (p: { scope: 'all' | any }) => {
    const items = p?.scope === 'all' ? cold.list() : cold.list(p?.scope)
    for (const item of items) cold.remove(item.name)
    return { ok: true, cleared: items.length }
  })

  // 配置 / 人格
  router.onReq(IPC.CONFIG_GET, async () => ({ config: config.get() }))
  router.onReq(IPC.CONFIG_SET, async (p: { patch: object }) => {
    const next = config.patch(p?.patch ?? {})
    gateway.setBaseUrl(next.gatewayUrl)
    emit({ type: IPC.CONFIG_UPDATED, payload: { config: next } })
    return { config: next }
  })
  router.onReq(IPC.PERSONA_GET, async () => ({ persona: config.getPersona() }))
  router.onReq(IPC.PERSONA_SET, async (p: object) => {
    const persona = config.setPersona((p as any)?.persona ?? p ?? {})
    emit({ type: IPC.PERSONA_UPDATED, payload: { persona } })
    return { persona }
  })

  // 登录类（H 代理调网关并管 Keychain，§3.1）
  router.onReq(IPC.LOGIN_REQUEST_CODE, async (p: { email: string }) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p?.email ?? '')) throw new IpcError('BAD_REQUEST', '邮箱格式不对')
    return gateway.requestCode(p.email)
  })
  router.onReq(IPC.LOGIN_SUBMIT, async (p: { email: string; code: string }) => {
    const res = await gateway.submitCode(p?.email ?? '', p?.code ?? '')
    authState = { loginState: 'logged_in', email: res.email }
    emit({ type: IPC.AUTH_STATE_CHANGED, payload: authState })
    tracker.track(TRACK.登录, {})
    return { ok: true, email: res.email }
  })
  router.onReq(IPC.LOGOUT, async () => {
    await gateway.logout()
    authState = { loginState: 'anon' }
    emit({ type: IPC.AUTH_STATE_CHANGED, payload: authState })
    tracker.track(TRACK.登出, {})
    return { ok: true }
  })

  // 系统类（SH→H event）
  router.onEvent(IPC.SYS_PERMISSION_STATE, (p: typeof sysState) => {
    Object.assign(sysState, p ?? {})
  })
  router.onEvent(IPC.SYS_IDLE_STATE, () => {
    // p01 心跳输入——M3 交付心跳判定；M1 只接收不动作（Gate ④ 链路通）
  })
  router.onEvent(IPC.PET_EMOTION_SIGNAL, (p: { state: Emotion; cause: string }) => {
    if (p?.state) { emotion = p.state; emotionCause = p.cause ?? '' }
  })
  router.onEvent(IPC.TRACK_EVENT, (p: { eventId: number; props: Record<string, unknown> }) => {
    if (typeof p?.eventId === 'number') tracker.track(p.eventId, p.props ?? {})
  })

  // 启动即恢复登录态（token 在 Keychain）
  void gateway.loadTokens().then((ok) => {
    if (ok) {
      authState = { loginState: 'logged_in' }
      emit({ type: IPC.AUTH_STATE_CHANGED, payload: authState })
    }
  })
  tracker.track(TRACK.桌宠_启动, { version: '3.0.0', startMs: Date.now() - startedAt })

  return {
    router,
    dispatchLine: async (line: string) => {
      const env = decodeLine(line)
      if (!env) { console.error('[ipc] 非法行，drop'); return }
      await router.dispatch(env)
    },
    shutdown: () => { tracker.stop(); db.close() },
    // 测试钩子
    _internals: { hooks, registry, queue, pool, store, config, get emotion() { return emotion } },
  }
}

// ---- 直接运行：接管 stdio ----
const isMain = process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts')
if (isMain) {
  const harness = createHarness((line) => process.stdout.write(line))
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => void harness.dispatchLine(line))
  rl.on('close', () => { harness.shutdown(); process.exit(0) })
  process.on('SIGTERM', () => { harness.shutdown(); process.exit(0) })
  console.error(`[harness] 就绪 pid=${process.pid}`)   // 日志走 stderr，stdout 只发协议
}

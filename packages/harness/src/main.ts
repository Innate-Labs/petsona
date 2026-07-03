// stdio NDJSON server 入口——壳 spawn 本进程，stdin 收 Envelope、stdout 发 Envelope
// 装配所有子系统 + 注册 §3.1 全消息表（M1 Gate ④：未用到的返回占位）

import { createInterface } from 'node:readline'
import type { Emotion, Envelope, FileOp, StagingPlan, TaskResult } from '@petsona/shared'
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
import { registerHeavyTools } from './tools/heavy/index.js'
import { InjectionQueue } from './loop/injection_queue.js'
import { CompanionLoop } from './loop/companion.js'
import { ReminderConsumer } from './loop/reminder_consumer.js'
import { CronScheduler } from './scheduler/cron.js'
import { Heartbeat } from './scheduler/heartbeat.js'
import { decideProactive, isSimilarToRecent } from './persona/proactive.js'
import { buildSegments } from './persona/assemble.js'
import { Tracker } from './telemetry/track.js'
import { TaskBoard, TaskBoardError } from './tasks/board.js'
import { makeSubagentExecutor, validateTaskResult } from './tasks/subagent.js'
import { StagingStore } from './staging/store.js'
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
  const staging = new StagingStore(paths)

  // ---- hooks 与工具注册表（companion/subagent 结构隔离，但共享权限/审计管线） ----
  const hooks = new HookPipeline()
  const registry = new ToolRegistry('companion')
  const subagentRegistry = new ToolRegistry('subagent')
  registerHeavyTools(subagentRegistry, { paths, staging })
  const permissionRegistry = {
    get: (name: string) => registry.get(name) ?? subagentRegistry.get(name),
  }

  const taskBoard = new TaskBoard({
    tasksDir: paths.tasksDir,
    getConfig: () => config.get(),
    emit,
    executor: makeSubagentExecutor({
      gateway,
      registry: subagentRegistry,
      hooks,
      paths,
      emit,
      getConfig: () => config.get(),
      staging,
    }),
    enqueueResult: (task) => {
      const status = task.status
      const summary = task.result?.didWhat?.join('；') || task.result?.leftover?.join('；') || task.goal
      queue.push({
        source: 'task',
        priority: 1,
        content: `<task-result id="${task.id}" status="${status}">${summary}</task-result>`,
        dedupeKey: `task:${task.id}:${status}`,
        expiresAt: Date.now() + 30 * 60_000,
      })
    },
    onDispatch: (task) => tracker.track(TRACK.任务_派发, {
      agentType: task.agentType,
      skill: task.skill,
      scopeDirs: task.scope.dirs.length,
    }),
    onAwaitingApproval: (_task, digest) => tracker.track(TRACK.审批_请求, {
      opCounts: digest.counts,
      risk: digest.risk,
    }),
    onResult: (task) => tracker.track(TRACK.任务_完成, {
      status: task.status,
      toolCalls: task.usage.toolCalls,
      tokens: task.usage.tokens,
      durationSec: task.result?.stats.durationSec ?? 0,
    }),
  })

  // ---- hooks 管线全挂载（§3.7 固定顺序；M1 部分为 stub 但链路走通） ----
  hooks.onPreTurn('injection_guard', injectionGuard)
  hooks.onPreTurn('local_rate', makeLocalRate(pool))
  hooks.onPreTurn('track_start', async () => { /* 对话_发起在 loop 内带字数埋点，这里保管线位 */ })
  hooks.onPreLLM('memory_assemble', async () => { /* 装配在 loop 内执行（需 triggers/预算上下文），此处保管线位 */ })
  hooks.onPreLLM('injection_drain', async (ctx) => {
    // 提醒条目（<reminder …/>）由 ReminderConsumer 直出气泡，不进 LLM 上下文——避免双重播报
    const items = queue.drain(Date.now(), (i) => !i.content.startsWith('<reminder '))
    if (items.length) {
      ctx.messages.push({ role: 'user', content: items.map((i) => i.content).join('\n') })
    }
  })
  hooks.onPostLLM('persona_enforce', personaEnforceHook)
  hooks.onPostLLM('bubble_compress', makeBubbleCompressHook(gateway))
  hooks.onPostLLM('fallback', makeFallbackHook(pool))
  hooks.onPostLLM('track_end', makeTrackEndHook(tracker))

  hooks.onPreToolUse('permission', makePermissionHook(permissionRegistry, pool, emit))
  hooks.onPreToolUse('scope', scopeHook)
  hooks.onPreToolUse('audit', makeAuditHook(paths.auditLog, permissionRegistry))
  hooks.onPostToolUse('persist_large', makePersistLargeHook(paths.outputsDir))
  hooks.onPostToolUse('staging_record', stagingRecordHook)
  hooks.onPostToolUse('progress_mirror', progressMirrorHook)
  hooks.onSubagentStop('result_schema', validateTaskResult)

  registerLightTools(registry, { store, skills, paths, taskBoard, emit, sysState })

  const loop = new CompanionLoop({
    gateway, store, registry, hooks, queue, pool, tracker, paths, emit,
    getEmotion: () => emotion,
  })

  // ---- M3 调度与主动性（§3.8）：调度器纯生产，消费与 LLM 决策都在外面接线 ----
  const idleNow = { fullscreen: false }
  const scheduler = new CronScheduler({
    jobsPath: paths.scheduled,
    queue,
    getConfig: () => config.get(),
    onDream: async () => {
      const report = await store.dream()
      console.error('[scheduler] dream 报告:', JSON.stringify(report))
    },
  })
  const consumer = new ReminderConsumer({
    queue, pool,
    getConfig: () => config.get(),
    getFullscreen: () => idleNow.fullscreen,
    isLoopBusy: () => loop.isBusy,
    emit,
    track: (id, props) => tracker.track(id, props),
  })
  const heartbeat = new Heartbeat({
    getConfig: () => config.get(),
    decide: (input) => decideProactive(gateway, {
      ...input,
      personaCore: buildSegments(paths, emotion).personaCore,
    }),
    isDuplicate: (text, recent) => isSimilarToRecent(gateway, text, recent),
    emitProactive: (text) => {
      // 主动气泡落 hot 轮次：下一轮对话模型知道自己刚主动说过什么（SPEC-GAP: 规格未写，取上下文连续性默认）
      db.insertTurn('pet', text, Date.now())
      emit({ type: IPC.PET_BUBBLE, payload: { text, durationMs: 8000, kind: 'proactive' } })
      tracker.track(TRACK.主动气泡_展示, { chars: text.length })
    },
    statePath: paths.proactive,
  })
  scheduler.start()
  consumer.start()

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

  // 任务与审批类
  router.onReq(IPC.TASK_LIST_GET, async () => ({ tasks: taskBoard.list() }))
  router.onReq(IPC.TASK_CANCEL, async (p: { taskId?: string }) => {
    try {
      return taskBoard.cancel(String(p?.taskId ?? ''))
    } catch (err) {
      if (err instanceof TaskBoardError) throw new IpcError(err.code, err.message)
      throw err
    }
  })
  router.onReq(IPC.PLAN_GET, async (p: { planId?: string }) => {
    const plan = staging.get(String(p?.planId ?? ''))
    if (!plan) throw new IpcError('BAD_REQUEST', '审批计划不存在')
    return { plan }
  })
  router.onReq(IPC.APPROVAL_DECISION, async (p: {
    planId?: string
    decision?: 'approve' | 'reject' | 'partial'
    excludedOpIds?: string[]
  }) => {
    const planId = String(p?.planId ?? '')
    const plan = staging.get(planId)
    if (!plan) throw new IpcError('BAD_REQUEST', '审批计划不存在')
    const decision = p?.decision ?? 'reject'
    tracker.track(TRACK.审批_决策, {
      decision,
      excluded: Array.isArray(p?.excludedOpIds) ? p.excludedOpIds.length : 0,
    })
    if (decision === 'reject') {
      const rejected = staging.reject(planId)
      taskBoard.rejectApproval(rejected.taskId)
      return { ok: true, plan: rejected }
    }
    try {
      const applyingTask = taskBoard.markApplying(plan.taskId)
      const excludedOpIds = decision === 'partial' ? p.excludedOpIds ?? [] : []
      const outcome = staging.apply(planId, excludedOpIds)
      const result = approvalResult(applyingTask.result, outcome.plan, outcome.applied, outcome.failed, excludedOpIds)
      taskBoard.completeAfterApproval(plan.taskId, result)
      if (outcome.failed.length) throw new IpcError('STAGING_APPLY_FAILED', outcome.failed[0]?.reason ?? '应用失败')
      return { ok: true, applied: outcome.applied, failed: outcome.failed, plan: outcome.plan }
    } catch (err) {
      if (err instanceof IpcError) throw err
      const result: TaskResult = {
        ok: false,
        didWhat: plan.ops.length ? ['审批通过，但应用 staging 计划失败'] : [],
        changes: [],
        leftover: [err instanceof Error ? err.message : String(err)],
        stats: { durationSec: 0 },
      }
      try { taskBoard.completeAfterApproval(plan.taskId, result) } catch { /* 状态可能已收口 */ }
      throw new IpcError('STAGING_APPLY_FAILED', err instanceof Error ? err.message : String(err))
    }
  })
  router.onReq(IPC.UNDO_REQUEST, async (p: { planId?: string }) => {
    try {
      const out = staging.undo(String(p?.planId ?? ''))
      tracker.track(TRACK.撤销_触发, { restored: out.restored, failed: out.failed.length })
      return out
    } catch (err) {
      throw new IpcError('BAD_REQUEST', err instanceof Error ? err.message : String(err))
    }
  })

  // 提醒类（M3 调度器）
  const REMINDER_KINDS = ['pomodoro', 'water', 'stand'] as const
  router.onReq(IPC.REMINDER_SET, async (p: { kind?: string; config?: object }) => {
    const kind = REMINDER_KINDS.find((k) => k === p?.kind)
    if (!kind) throw new IpcError('BAD_REQUEST', `kind 必须是 ${REMINDER_KINDS.join('/')}`)
    scheduler.setReminder(kind, p?.config)
    tracker.track(TRACK.提醒_设置, { kind })
    return { ok: true, kind }
  })
  router.onReq(IPC.REMINDER_STOP, async (p: { kind?: string }) => {
    const kind = REMINDER_KINDS.find((k) => k === p?.kind)
    if (!kind) throw new IpcError('BAD_REQUEST', `kind 必须是 ${REMINDER_KINDS.join('/')}`)
    scheduler.stopReminder(kind)
    return { ok: true, kind }
  })

  // 记忆类
  router.onReq(IPC.MEMORY_LIST_GET, async (p: { type?: any }) => ({ items: cold.metas(p?.type) }))
  router.onReq(IPC.MEMORY_GET, async (p: { name?: string }) => {
    const item = cold.read(String(p?.name ?? ''))
    if (!item) throw new IpcError('BAD_REQUEST', '记忆不存在')
    return { item }
  })
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
  // 为什么要有 pull 口：harness 启动恢复登录态的广播可能早于面板 webview 订阅，
  // 只靠 AUTH_STATE_CHANGED 会丢事件（真机竞态实测），面板挂载时必须能主动拉一次
  router.onReq(IPC.AUTH_STATE_GET, async () => authState)
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
  router.onEvent(IPC.SYS_IDLE_STATE, (p: { idleMinutes?: number; fullscreen?: boolean }) => {
    const payload = { idleMinutes: p?.idleMinutes ?? 0, fullscreen: !!p?.fullscreen }
    if (payload.fullscreen !== idleNow.fullscreen) console.error(`[idle] fullscreen=${payload.fullscreen}`)
    idleNow.fullscreen = payload.fullscreen
    void heartbeat.onIdle(payload)
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
    shutdown: () => { scheduler.stop(); consumer.stop(); tracker.stop(); db.close() },
    // 测试钩子
    _internals: { hooks, registry, subagentRegistry, staging, queue, pool, store, config, scheduler, heartbeat, consumer, get emotion() { return emotion } },
  }
}

function approvalResult(
  previous: TaskResult | undefined,
  plan: StagingPlan,
  applied: number,
  failed: { opId: string; reason: string }[],
  excludedOpIds: string[] = [],
): TaskResult {
  const excluded = new Set(excludedOpIds)
  return {
    ok: failed.length === 0,
    didWhat: [...(previous?.didWhat ?? []), `已应用 ${applied} 项审批操作`],
    changes: plan.ops.filter((op) => !excluded.has(op.opId)).map(opToChange),
    findings: previous?.findings,
    leftover: failed.length
      ? failed.map((f) => `${f.opId}: ${f.reason}`)
      : (previous?.leftover ?? []).filter((x) => !x.includes('等待用户审批')),
    stats: { ...previous?.stats, durationSec: previous?.stats.durationSec ?? 0 },
  }
}

function opToChange(op: FileOp): { op: string; path: string } {
  switch (op.op) {
    case 'write':
    case 'mkdir':
      return { op: op.op, path: op.dst }
    case 'move':
    case 'rename':
      return { op: op.op, path: op.dst }
    case 'trash':
      return { op: op.op, path: op.src }
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

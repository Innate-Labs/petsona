// s01 陪伴循环——唯一人格出口（p03），常驻，流式首字 ≤2s
// 每轮：PreTurn → [extract→compact] → PreLLM(记忆装配+注入drain) → LLM 流式(含轻工具循环) → PostLLM → 落轮次

import { randomUUID } from 'node:crypto'
import type { Emotion, LlmContentBlock, LlmMessage, LlmSseToolUse } from '@petsona/shared'
import { IPC, TRACK } from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'
import type { LocalMemoryStore } from '../memory/store.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { HookPipeline } from '../hooks/pipeline.js'
import type { InjectionQueue } from './injection_queue.js'
import type { FallbackPool } from '../persona/fallback_pool.js'
import type { Tracker } from '../telemetry/track.js'
import type { DataPaths } from '../paths.js'
import { buildSegments, assembleSystem } from '../persona/assemble.js'
import { renderMemory } from '../memory/selection.js'
import { runCompact, estimateChars, COMPACT_THRESHOLD_CHARS, type CompactContext } from '../compact/index.js'

const MAX_TOOL_ROUNDS = 6   // SPEC-GAP: 陪伴循环单轮工具循环上限未定，取 6 防失控

export type CompanionDeps = {
  gateway: GatewayClient
  store: LocalMemoryStore
  registry: ToolRegistry
  hooks: HookPipeline
  queue: InjectionQueue
  pool: FallbackPool
  tracker: Tracker
  paths: DataPaths
  emit: (event: { type: string; payload: unknown }) => void
  getEmotion: () => Emotion
  getUserPersona: () => string
}

export class CompanionLoop {
  private busy = false

  constructor(private deps: CompanionDeps) {}

  /** 提醒消费器只在循环空闲时直出气泡（§3.8 陪伴循环空闲时消费） */
  get isBusy(): boolean {
    return this.busy
  }

  async handleChatSend(text: string): Promise<{ turnId: string }> {
    const turnId = `turn_${randomUUID().slice(0, 8)}`
    // 不阻塞 res：异步跑整轮，事件流推进 UI
    void this.runTurn(turnId, text).catch((err) => {
      this.deps.emit({
        type: IPC.CHAT_ERROR,
        payload: { turnId, code: 'UPSTREAM', petLine: this.deps.pool.pick('generic_error') },
      })
      console.error('[companion] turn 失败:', err)
    })
    return { turnId }
  }

  private async runTurn(turnId: string, rawText: string): Promise<void> {
    const { hooks, store, pool, tracker, emit } = this.deps
    if (this.busy) {
      emit({ type: IPC.CHAT_ERROR, payload: { turnId, code: 'RATE_LIMIT', petLine: pool.pick('rate_limit') } })
      return
    }
    this.busy = true
    hooks.resetTrace()
    try {
      // ---- PreTurn：injection_guard → local_rate → track_start ----
      const preCtx = { userText: rawText, source: 'panel' }
      const rejected = await hooks.runPreTurn(preCtx)
      if (rejected) {
        emit({ type: IPC.CHAT_ERROR, payload: { turnId, code: rejected.reject, petLine: rejected.petLine } })
        return
      }
      const text = preCtx.userText

      // 落 user 轮次 + 异步打标（cheap 档，失败 _untagged）
      const userTurnId = store.db.insertTurn('user', text, Date.now())
      void store.tagTurn({ id: userTurnId, role: 'user', text, t: Date.now(), topics: [] })

      // ---- 会话上下文（hot 在场部分） ----
      let messages: LlmMessage[] = store.db
        .recentTurns(20)
        .map((t) => ({ role: t.role === 'user' ? 'user' as const : 'assistant' as const, content: t.text }))
      if (messages.length === 0 || messages[messages.length - 1]!.content !== text) {
        messages.push({ role: 'user', content: text })
      }

      // ---- s08 压缩（assemble 之前；压缩前必先 extract——先记住，再遗忘） ----
      const memory = store.assemble(this.triggers())
      const memBlock = renderMemory(memory)
      let compactCtx: CompactContext = {
        messages,
        warmBlock: memBlock,
        coldBlock: memory.cold.map((c) => `[${c.type}/${c.topic}] ${c.body}`).join('\n'),
        tierDowngraded: false,
        applied: [],
      }
      if (estimateChars(compactCtx) > COMPACT_THRESHOLD_CHARS * 0.8) {
        await store.extract(messages)                  // 压缩前快照提取（s09 纪律）
        compactCtx = runCompact(compactCtx)
        hooks.trace.push(`compact:${compactCtx.applied.join('+') || 'noop'}`)
        messages = compactCtx.messages
      }

      // ---- PreLLM：memory_assemble + injection_drain（管线挂载，hook 内改 messages） ----
      const llmCtx = { messages, loop: 'companion' as const }
      await hooks.runPreLLM(llmCtx)
      messages = llmCtx.messages
      // 记忆块作为首条 user 消息注入（system 只放稳定段，保护 prompt cache——s10）
      if (memBlock) {
        messages.unshift({ role: 'user', content: `${memBlock}\n（以上是你的记忆，自然引用，不要复述原文）` })
        messages.splice(1, 0, { role: 'assistant', content: '（记住了）' })
      }

      // ---- 系统提示组装（s10 段序） ----
      const seg = buildSegments(this.deps.paths, this.deps.getEmotion(), this.deps.getUserPersona())
      const { system } = assembleSystem(seg)

      tracker.track(TRACK.对话_发起, { chars: text.length })

      // ---- LLM 流式 + 轻工具循环 ----
      const tier = compactCtx.tierDowngraded ? 'cheap' : 'main'
      const finalText = await this.streamWithTools(turnId, system, messages, tier)
      if (finalText === null) return   // 错误已发 CHAT_ERROR

      // ---- PostLLM：persona_enforce → bubble_compress → fallback → track_end ----
      const draft = await hooks.runPostLLM({ text: finalText, loop: 'companion' })

      // 落 pet 轮次 + 打标 + 压缩触发 + turn 末提取
      const petTurnId = store.db.insertTurn('pet', draft.text, Date.now())
      void store.tagTurn({ id: petTurnId, role: 'pet', text: draft.text, t: Date.now(), topics: [] })
      void store.compactIfNeeded()
      void store.extract([...messages, { role: 'assistant', content: draft.text }]).then((items) => {
        if (items.length) tracker.track(TRACK.记忆_提取, { n: items.length, types: items.map((i) => i.type) })
      })

      emit({
        type: IPC.CHAT_DONE,
        payload: { turnId, reply: draft.text, bubble: draft.bubble ?? draft.text.slice(0, 18) },
      })
    } finally {
      this.busy = false
    }
  }

  /** 流式调用 + tool_use 执行循环；错误时发 CHAT_ERROR 并返回 null */
  private async streamWithTools(
    turnId: string, system: string, messages: LlmMessage[], tier: 'main' | 'cheap',
  ): Promise<string | null> {
    const { gateway, registry, hooks, pool, tracker, emit } = this.deps
    const convo = [...messages]

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let roundText = ''
      const toolUses: LlmSseToolUse[] = []
      const state = { stopReason: 'end_turn' as 'end_turn' | 'tool_use', errored: false }

      await gateway.chatStream(
        {
          tier, system, messages: convo,
          tools: registry.toLlmTools(),
          stream: true, maxTokens: 8000,
          meta: { loop: 'companion' },
        },
        {
          onDelta: (t) => {
            roundText += t
            emit({ type: IPC.CHAT_CHUNK, payload: { turnId, delta: t } })
          },
          // reasoning 流不进 roundText 也不喂回模型（reasoning 块只用于展示，纯 UI 事件）
          onReasoning: (t) => {
            emit({ type: IPC.CHAT_REASONING, payload: { turnId, delta: t } })
          },
          onToolUse: (tu) => toolUses.push(tu),
          onDone: (d) => { state.stopReason = d.stopReason },
          onError: (e) => {
            state.errored = true
            tracker.track(TRACK.AI_失败, { code: e.code })
            tracker.track(TRACK.兜底_触发, { scene: e.code })
            emit({ type: IPC.CHAT_ERROR, payload: { turnId, code: e.code, petLine: pool.forError(e.code) } })
          },
        },
      )
      if (state.errored) return null
      if (state.stopReason !== 'tool_use' || toolUses.length === 0) return roundText

      // 执行轻工具（PreToolUse 管线 → handler → PostToolUse 管线）
      const assistantBlocks: LlmContentBlock[] = []
      if (roundText) assistantBlocks.push({ type: 'text', text: roundText })
      const resultBlocks: LlmContentBlock[] = []
      for (const tu of toolUses) {
        emit({ type: IPC.CHAT_TOOLING, payload: { turnId, tool: tu.name, note: pool.pick(tu.name) } })
        assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
        resultBlocks.push(await this.execTool(tu))
      }
      convo.push({ role: 'assistant', content: assistantBlocks })
      convo.push({ role: 'user', content: resultBlocks })
    }
    // 工具循环超限：让模型收个尾（不再带 tools）
    return `（工具轮次到顶了）${''}`
  }

  private async execTool(tu: LlmSseToolUse): Promise<LlmContentBlock> {
    const { registry, hooks } = this.deps
    const call = { tool: tu.name, input: tu.input }
    const blocked = await hooks.runPreToolUse(call)
    if (blocked) {
      return { type: 'tool_result', tool_use_id: tu.id, content: `BLOCKED(${blocked.block}): ${blocked.message}`, is_error: true }
    }
    const def = registry.get(tu.name)
    if (!def) {
      return { type: 'tool_result', tool_use_id: tu.id, content: `未知工具 ${tu.name}`, is_error: true }
    }
    try {
      const raw = await def.handler(tu.input, {
        dataDir: this.deps.paths.root,
        emit: this.deps.emit,
        gateway: this.deps.gateway,
      })
      const output = typeof raw === 'string' ? raw : JSON.stringify(raw)
      const final = await hooks.runPostToolUse(call, output)
      return { type: 'tool_result', tool_use_id: tu.id, content: final }
    } catch (err) {
      return {
        type: 'tool_result', tool_use_id: tu.id,
        content: `工具执行失败: ${err instanceof Error ? err.message : err}`, is_error: true,
      }
    }
  }

  /** 话题触发词：近几轮 topics 并集（tagTurn 异步补写，取已有标签） */
  private triggers(): string[] {
    const topics = new Set<string>()
    for (const t of this.deps.store.db.recentTurns(6)) {
      for (const tp of t.topics) if (tp !== '_untagged') topics.add(tp)
    }
    return [...topics].slice(0, 5)
  }
}

// s04 hooks 管线唯一入口（§3.7）——新增横切逻辑 = 加文件注册，禁止改 loop
// 固定管线顺序（M1 即全量挂载，逻辑可为 stub）：
//   PreTurn:     injection_guard → local_rate → track_start
//   PostLLM:     persona_enforce → bubble_compress → fallback → track_end
//   PreToolUse:  permission → scope → audit
//   PostToolUse: persist_large(>30K) → staging_record → progress_mirror

import type { ErrCode, LlmLoop, LlmMessage, TaskResult } from '@petsona/shared'

export type PreTurnCtx = { userText: string; source: string }
export type PreTurnReject = { reject: ErrCode; petLine: string }
export type PreTurnHook = (ctx: PreTurnCtx) => Promise<void | PreTurnReject>

export type PreLLMCtx = { messages: LlmMessage[]; loop: LlmLoop }
export type PreLLMHook = (ctx: PreLLMCtx) => Promise<void>

export type PostLLMDraft = { text: string; loop: LlmLoop; bubble?: string; usedFallback?: boolean }
export type PostLLMHook = (draft: PostLLMDraft) => Promise<PostLLMDraft>

export type ToolCall = { tool: string; input: unknown; taskId?: string }
export type PreToolUseBlock = { block: ErrCode; message: string }
export type PreToolUseHook = (call: ToolCall) => Promise<void | PreToolUseBlock>

export type PostToolUseHook = (call: ToolCall, output: string) => Promise<string>

export type SubagentStopHook = (result: unknown) => Promise<TaskResult>

type Named<H> = { name: string; hook: H }

export class HookPipeline {
  private preTurn: Named<PreTurnHook>[] = []
  private preLLM: Named<PreLLMHook>[] = []
  private postLLM: Named<PostLLMHook>[] = []
  private preToolUse: Named<PreToolUseHook>[] = []
  private postToolUse: Named<PostToolUseHook>[] = []
  private subagentStop: Named<SubagentStopHook>[] = []

  /** 本轮 hookTrace（dev 模式附到 res/CHAT_DONE，继承 v2.1） */
  trace: string[] = []

  onPreTurn(name: string, hook: PreTurnHook): void { this.preTurn.push({ name, hook }) }
  onPreLLM(name: string, hook: PreLLMHook): void { this.preLLM.push({ name, hook }) }
  onPostLLM(name: string, hook: PostLLMHook): void { this.postLLM.push({ name, hook }) }
  onPreToolUse(name: string, hook: PreToolUseHook): void { this.preToolUse.push({ name, hook }) }
  onPostToolUse(name: string, hook: PostToolUseHook): void { this.postToolUse.push({ name, hook }) }
  onSubagentStop(name: string, hook: SubagentStopHook): void { this.subagentStop.push({ name, hook }) }

  resetTrace(): void { this.trace = [] }

  async runPreTurn(ctx: PreTurnCtx): Promise<void | PreTurnReject> {
    for (const { name, hook } of this.preTurn) {
      this.trace.push(`PreTurn:${name}`)
      const out = await hook(ctx)
      if (out) return out
    }
  }

  async runPreLLM(ctx: PreLLMCtx): Promise<void> {
    for (const { name, hook } of this.preLLM) {
      this.trace.push(`PreLLM:${name}`)
      await hook(ctx)
    }
  }

  async runPostLLM(draft: PostLLMDraft): Promise<PostLLMDraft> {
    let current = draft
    for (const { name, hook } of this.postLLM) {
      this.trace.push(`PostLLM:${name}`)
      current = await hook(current)
    }
    return current
  }

  async runPreToolUse(call: ToolCall): Promise<void | PreToolUseBlock> {
    for (const { name, hook } of this.preToolUse) {
      this.trace.push(`PreToolUse:${name}`)
      const out = await hook(call)
      if (out) return out
    }
  }

  async runPostToolUse(call: ToolCall, output: string): Promise<string> {
    let current = output
    for (const { name, hook } of this.postToolUse) {
      this.trace.push(`PostToolUse:${name}`)
      current = await hook(call, current)
    }
    return current
  }

  async runSubagentStop(result: unknown): Promise<TaskResult | null> {
    for (const { name, hook } of this.subagentStop) {
      this.trace.push(`SubagentStop:${name}`)
      return hook(result)
    }
    return null
  }

  /** 结构性约束单测用：各管线挂载点名单 */
  mounted(): Record<string, string[]> {
    return {
      PreTurn: this.preTurn.map((h) => h.name),
      PreLLM: this.preLLM.map((h) => h.name),
      PostLLM: this.postLLM.map((h) => h.name),
      PreToolUse: this.preToolUse.map((h) => h.name),
      PostToolUse: this.postToolUse.map((h) => h.name),
      SubagentStop: this.subagentStop.map((h) => h.name),
    }
  }
}

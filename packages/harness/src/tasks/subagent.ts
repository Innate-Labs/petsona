// M2 子 Agent 执行器：gateway LLM + subagent heavy tools + TaskResult schema 收口。

import type {
  Config, LlmContentBlock, LlmMessage, LlmSseToolUse, TaskRecord, TaskResult,
} from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'
import type { HookPipeline } from '../hooks/pipeline.js'
import type { DataPaths } from '../paths.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { StagingStore } from '../staging/store.js'
import { TaskAwaitingApproval, type TaskExecutor, type TaskExecutorContext } from './board.js'

const MAX_ROUNDS = 12

export type SubagentExecutorDeps = {
  gateway: GatewayClient
  registry: ToolRegistry
  hooks: HookPipeline
  paths: DataPaths
  emit: (event: { type: string; payload: unknown }) => void
  getConfig: () => Config
  staging?: StagingStore
}

export function makeSubagentExecutor(deps: SubagentExecutorDeps): TaskExecutor {
  return async (task, ctx) => runSubagentTask(task, ctx, deps)
}

export async function validateTaskResult(result: unknown): Promise<TaskResult> {
  if (!result || typeof result !== 'object') throw new Error('子 Agent 未返回对象')
  const r = result as Partial<TaskResult>
  return {
    ok: Boolean(r.ok),
    didWhat: stringArray(r.didWhat),
    changes: Array.isArray(r.changes)
      ? r.changes
        .filter((x): x is { op: string; path: string } =>
          !!x && typeof x === 'object' && typeof (x as { op?: unknown }).op === 'string'
          && typeof (x as { path?: unknown }).path === 'string')
        .map((x) => ({ op: x.op, path: x.path }))
      : [],
    findings: Array.isArray(r.findings) ? stringArray(r.findings) : undefined,
    leftover: stringArray(r.leftover),
    stats: {
      files: numberOrUndefined(r.stats?.files),
      bytes: numberOrUndefined(r.stats?.bytes),
      durationSec: Number(r.stats?.durationSec ?? 0),
    },
  }
}

async function runSubagentTask(
  task: TaskRecord,
  ctx: TaskExecutorContext,
  deps: SubagentExecutorDeps,
): Promise<TaskResult> {
  const started = Date.now()
  const budget = deps.getConfig().taskBudget
  const messages: LlmMessage[] = [{ role: 'user', content: renderTaskBrief(task) }]
  let toolCalls = 0
  let tokens = 0

  ctx.progress(`${task.agentType} 子 Agent 启动`)
  for (let round = 0; round < MAX_ROUNDS; round++) {
    throwIfAborted(ctx.signal)
    const res = await deps.gateway.chatOnce({
      tier: 'main',
      system: systemPrompt(task),
      messages,
      tools: deps.registry.toLlmTools(),
      stream: false,
      maxTokens: 8000,
      meta: { loop: 'subagent', taskId: task.id },
    })
    const roundTokens = res.usage.in + res.usage.out
    tokens += roundTokens
    ctx.usage({ tokens: roundTokens })
    if (tokens > budget.maxTokens) throw new Error('TASK_BUDGET_EXCEEDED: token budget exceeded')

    const toolUses = res.content.filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    if (res.stopReason !== 'tool_use' || toolUses.length === 0) {
      let checked: TaskResult
      try {
        const parsed = parseFinalResult(textFromBlocks(res.content))
        checked = await deps.hooks.runSubagentStop(parsed) ?? await validateTaskResult(parsed)
      } catch (err) {
        // 为什么不直接 fail：staged 计划才是真实产出，最终 JSON 只是摘要；
        // 摘要解析失败但已有待审批改动时必须继续走审批，否则计划会烂在 staging 里没人认领
        if (!deps.staging?.hasPending(task.id)) throw err
        checked = {
          ok: false,
          didWhat: [],
          changes: [],
          leftover: [`最终摘要解析失败：${err instanceof Error ? err.message : err}`],
          stats: { durationSec: 0 },
        }
      }
      const finalResult = {
        ...checked,
        stats: {
          ...checked.stats,
          durationSec: Math.max(0, Math.round((Date.now() - started) / 1000)),
        },
      }
      if (deps.staging?.hasPending(task.id)) {
        const plan = deps.staging.createPlan(task.id)
        throw new TaskAwaitingApproval(plan.planId, plan.digest, {
          ...finalResult,
          ok: true,
          didWhat: [...finalResult.didWhat, '已生成待审批 staging 计划'],
          changes: [],
          leftover: [...finalResult.leftover, '等待用户审批后应用文件改动'],
        })
      }
      return finalResult
    }

    const assistantBlocks: LlmContentBlock[] = []
    for (const block of res.content) assistantBlocks.push(block)
    const resultBlocks: LlmContentBlock[] = []
    for (const tu of toolUses) {
      toolCalls += 1
      ctx.usage({ toolCalls: 1 })
      if (toolCalls > budget.maxToolCalls) throw new Error('TASK_BUDGET_EXCEEDED: tool call budget exceeded')
      resultBlocks.push(await execTool(tu, task, deps))
    }
    messages.push({ role: 'assistant', content: assistantBlocks })
    messages.push({ role: 'user', content: resultBlocks })
  }
  throw new Error('子 Agent 工具轮次超限')
}

async function execTool(
  tu: LlmSseToolUse,
  task: TaskRecord,
  deps: SubagentExecutorDeps,
): Promise<LlmContentBlock> {
  const call = { tool: tu.name, input: tu.input, taskId: task.id, scope: task.scope }
  const blocked = await deps.hooks.runPreToolUse(call)
  if (blocked) {
    return {
      type: 'tool_result',
      tool_use_id: tu.id,
      content: `BLOCKED(${blocked.block}): ${blocked.message}`,
      is_error: true,
    }
  }
  const def = deps.registry.get(tu.name)
  if (!def) {
    return { type: 'tool_result', tool_use_id: tu.id, content: `未知工具 ${tu.name}`, is_error: true }
  }
  try {
    const raw = await def.handler(tu.input, {
      taskId: task.id,
      scope: task.scope,
      dataDir: deps.paths.root,
      emit: deps.emit,
      gateway: deps.gateway,
    })
    const output = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const final = await deps.hooks.runPostToolUse(call, output)
    return { type: 'tool_result', tool_use_id: tu.id, content: final }
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: tu.id,
      content: `工具执行失败: ${err instanceof Error ? err.message : err}`,
      is_error: true,
    }
  }
}

function renderTaskBrief(task: TaskRecord): string {
  return [
    `任务 ID：${task.id}`,
    `类型：${task.agentType}`,
    `目标：${task.goal}`,
    `授权目录：${task.scope.dirs.join(', ')}`,
    `联网授权：${task.scope.net ? 'yes' : 'no'}`,
    task.skill ? `指定技能：${task.skill}` : '',
  ].filter(Boolean).join('\n')
}

function systemPrompt(task: TaskRecord): string {
  const mode = task.agentType === 'explore'
    ? '你是只读探索子 Agent。只使用 fs_read/fs_glob/shell(只读命令)/report_progress/todo_write；不要写文件。'
    : '你是执行型 worker 子 Agent。可以在授权 scope 内提出文件写入、移动、重命名、回收和运行必要命令；文件改动会先进入 staging，审批通过后才应用。'
  return `${mode}
所有路径必须位于任务授权目录内；不要尝试绕过权限、读取凭证或访问未授权网络。
需要工具时使用工具；完成时只输出一个 JSON 对象，不要 Markdown，不要解释。
JSON schema:
{"ok":true,"didWhat":["事实动作"],"changes":[{"op":"write|move|rename|trash|shell|none","path":"路径"}],"findings":["探索发现，可选"],"leftover":["未完成事项及原因"],"stats":{"files":0,"bytes":0,"durationSec":0}}`
}

function parseFinalResult(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('子 Agent 未返回最终结果')
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed)
    if (match) return JSON.parse(match[0])
    throw new Error('子 Agent 最终结果不是 JSON')
  }
}

function textFromBlocks(blocks: LlmContentBlock[]): string {
  return blocks.filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('cancelled')
}

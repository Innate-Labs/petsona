import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, IPC, type LlmChatResponse, type LlmChatRequest, type TaskRecord } from '@petsona/shared'
import { HookPipeline } from '../../packages/harness/src/hooks/pipeline.js'
import { scopeHook } from '../../packages/harness/src/hooks/pre/tooluse.js'
import { resolvePaths } from '../../packages/harness/src/paths.js'
import { makeSubagentExecutor, validateTaskResult } from '../../packages/harness/src/tasks/subagent.js'
import { registerHeavyTools } from '../../packages/harness/src/tools/heavy/index.js'
import { ToolRegistry } from '../../packages/harness/src/tools/registry.js'
import type { GatewayClient } from '../../packages/harness/src/gateway/client.js'

function task(scopeDir: string): TaskRecord {
  return {
    id: 'task_test',
    goal: '报告进度后完成',
    agentType: 'worker',
    scope: { dirs: [scopeDir], net: false },
    status: 'running',
    createdAt: Date.now(),
    usage: { toolCalls: 0, tokens: 0 },
  }
}

describe('Subagent executor', () => {
  it('执行 tool_use 循环并校验最终 TaskResult', async () => {
    const root = mkdtempSync(join(tmpdir(), 'petsona-subagent-'))
    process.env.PETSONA_DATA_DIR = root
    const paths = resolvePaths('test-user')
    const registry = new ToolRegistry('subagent')
    registerHeavyTools(registry, { paths })
    const hooks = new HookPipeline()
    hooks.onPreToolUse('scope', scopeHook)
    hooks.onSubagentStop('result_schema', validateTaskResult)
    const events: { type: string; payload: any }[] = []
    const responses: LlmChatResponse[] = [
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'report_progress', input: { note: '处理中' } }],
        stopReason: 'tool_use',
        usage: { in: 10, out: 2 },
      },
      {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            didWhat: ['报告了进度'],
            changes: [],
            leftover: [],
            stats: { durationSec: 0 },
          }),
        }],
        stopReason: 'end_turn',
        usage: { in: 10, out: 10 },
      },
    ]
    const gateway = {
      chatOnce: async (_req: LlmChatRequest) => responses.shift()!,
    } as unknown as GatewayClient
    const executor = makeSubagentExecutor({
      gateway,
      registry,
      hooks,
      paths,
      emit: (event) => events.push(event),
      getConfig: () => DEFAULT_CONFIG,
    })

    const usage = { toolCalls: 0, tokens: 0 }
    const result = await executor(task(paths.root), {
      signal: new AbortController().signal,
      progress: () => {},
      usage: (delta) => {
        usage.toolCalls += delta.toolCalls ?? 0
        usage.tokens += delta.tokens ?? 0
      },
    })

    expect(result.ok).toBe(true)
    expect(result.didWhat).toEqual(['报告了进度'])
    expect(usage).toEqual({ toolCalls: 1, tokens: 32 })
    expect(events.some((e) => e.type === IPC.TASK_EVENT && e.payload.note === '处理中')).toBe(true)
  })

  it('scopeHook 拦截授权目录外路径', async () => {
    const allowed = mkdtempSync(join(tmpdir(), 'petsona-scope-'))
    const blocked = await scopeHook({
      tool: 'fs_read',
      input: { path: '/etc/passwd' },
      scope: { dirs: [allowed], net: false },
    })
    expect(blocked?.block).toBe('SCOPE_VIOLATION')
  })
})

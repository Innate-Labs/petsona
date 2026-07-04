// M1 Gate ⑤：hooks 管线全挂载（§3.7 固定顺序，stub 可但链路必须走通）

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../packages/harness/src/main.js'

let harness: ReturnType<typeof createHarness>
const lines: string[] = []

beforeAll(() => {
  process.env.PETSONA_DATA_DIR = mkdtempSync(join(tmpdir(), 'petsona-hooks-'))
  process.env.PETSONA_KEYCHAIN = 'memory'
  process.env.PETSONA_GATEWAY_URL = 'http://127.0.0.1:9'
  harness = createHarness((l) => lines.push(l))
})

describe('Gate ⑤：hooks 管线全挂载且顺序固定', () => {
  it('PreTurn: injection_guard → local_rate → track_start', () => {
    expect(harness._internals.hooks.mounted().PreTurn).toEqual(['injection_guard', 'local_rate', 'track_start'])
  })

  it('PreLLM: memory_assemble → injection_drain', () => {
    expect(harness._internals.hooks.mounted().PreLLM).toEqual(['memory_assemble', 'injection_drain'])
  })

  it('PostLLM: persona_enforce → bubble_compress → fallback → track_end', () => {
    expect(harness._internals.hooks.mounted().PostLLM).toEqual(['persona_enforce', 'bubble_compress', 'fallback', 'track_end'])
  })

  it('PreToolUse: permission → scope → audit', () => {
    expect(harness._internals.hooks.mounted().PreToolUse).toEqual(['permission', 'scope', 'audit'])
  })

  it('PostToolUse: persist_large → staging_record → progress_mirror', () => {
    expect(harness._internals.hooks.mounted().PostToolUse).toEqual(['persist_large', 'staging_record', 'progress_mirror'])
  })

  it('SubagentStop: result_schema（M2 生效，M1 占位挂载）', () => {
    expect(harness._internals.hooks.mounted().SubagentStop).toEqual(['result_schema'])
  })

  it('兜底文案池已加载且核心 key 齐全（每条 ≥3 变体）', () => {
    const pool = harness._internals.pool
    for (const key of ['llm_timeout', 'llm_unreachable', 'rate_limit', 'os_permission_missing', 'generic_error']) {
      expect(pool.has(key), key).toBe(true)
      const seen = new Set([pool.pick(key), pool.pick(key), pool.pick(key)])
      expect(seen.size, `${key} 变体数`).toBeGreaterThanOrEqual(3)
    }
  })

  it('情绪镜像随 PET_EMOTION_SIGNAL 外发同步更新（persona EMOTION_STATE 数据源）', async () => {
    const reg = harness._internals.registry
    await reg.get('set_emotion')!.handler({ state: 'happy', cause: '测试' }, {
      dataDir: '', emit: () => {}, gateway: null,
    } as any)
    // set_emotion 的 handler 用的是装配期注入的 emit（main 的闭包），此处直接断言内部状态
    // 通过 harness 内部 getter 读取
    expect(harness._internals.emotion).toBe('happy')
  })
})

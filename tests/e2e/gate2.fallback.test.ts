// M1 Gate ②：断 LLM → 兜底文案池生效、宠物不失声（≥3 变体轮换）

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessProc } from '../helpers/harness.js'

let h: HarnessProc

beforeAll(async () => {
  h = new HarnessProc({
    PETSONA_DATA_DIR: mkdtempSync(join(tmpdir(), 'petsona-gate2-')),
    PETSONA_GATEWAY_URL: 'http://127.0.0.1:9',   // 死端口 = 断网/断 LLM
  })
  await h.request('PING', {})
})

afterAll(() => h.kill())

describe('Gate ②：断 LLM 兜底', () => {
  it('CHAT_SEND → CHAT_ERROR 带非空 petLine（宠物不失声）', async () => {
    const { turnId } = await h.request('CHAT_SEND', { text: '在吗' })
    const err = await h.waitFor((e) => e.type === 'CHAT_ERROR' && e.payload?.turnId === turnId, 20_000)
    expect(['UPSTREAM', 'TIMEOUT']).toContain(err.payload.code)
    expect(err.payload.petLine.length).toBeGreaterThan(0)
  })

  it('连续触发 3 次 → 文案变体轮换（每条 ≥3 变体，§7）', async () => {
    const lines = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const { turnId } = await h.request('CHAT_SEND', { text: `再试 ${i}` })
      const err = await h.waitFor((e) => e.type === 'CHAT_ERROR' && e.payload?.turnId === turnId, 20_000)
      lines.add(err.payload.petLine)
    }
    expect(lines.size).toBeGreaterThanOrEqual(2)   // 3 变体轮换下 3 次至少 2 个不同（首条已被上一用例消费）
  })

  it('断网期间本地功能仍可用：历史 / 记忆浏览 / PING', async () => {
    expect((await h.request('PING', {})).ok).toBe(true)
    expect((await h.request('CHAT_HISTORY_GET', { limit: 5 })).turns).toBeDefined()
    expect((await h.request('MEMORY_LIST_GET', {})).items).toBeDefined()
  })
})

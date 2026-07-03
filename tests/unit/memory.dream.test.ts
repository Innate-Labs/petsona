// 夜间 Dream（§3.8）：hot→warm 压缩、warm→cold 合并、cold consolidate、MEMORY.md 重建、DreamReport
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ColdSource } from '@petsona/shared'
import { HOT_COMPACT_THRESHOLD, WARM_MERGE_THRESHOLD, COLD_MAX_ITEMS } from '@petsona/shared'
import { SessionsDb } from '../../packages/harness/src/memory/sqlite.js'
import { ColdFs } from '../../packages/harness/src/memory/coldfs.js'
import { runDream, type DreamDeps } from '../../packages/harness/src/memory/dream.js'

let db: SessionsDb
let cold: ColdFs
let indexPath: string
let coldSeq: number

function makeDeps(): DreamDeps {
  return {
    db, cold,
    summarize: async (text) => `摘要:${text.slice(0, 20)}`,
    writeCold: (body, topic) => {
      cold.write({
        name: `dream-merged-${coldSeq++}`,
        type: 'fact', topic, source: 'system',
        lastT: new Date().toISOString(), body,
      })
    },
  }
}

function seedCold(name: string, body: string, lastT: string, source: ColdSource = 'chat', topic = 'work') {
  cold.write({ name, type: 'fact', topic, source, lastT, body })
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'petsona-dream-'))
  db = new SessionsDb(join(dir, 'sessions.db'))
  indexPath = join(dir, 'MEMORY.md')
  cold = new ColdFs(join(dir, 'cold'), indexPath)
  coldSeq = 0
})

describe('runDream', () => {
  it('空库跑通：全零报告 + 索引已建', async () => {
    const report = await runDream(makeDeps())
    expect(report.hotCompacted).toBe(0)
    expect(report.warmMerged).toBe(0)
    expect(report.coldMergedDupes).toBe(0)
    expect(report.coldEvicted).toBe(0)
    expect(report.indexRebuilt).toBe(true)
    expect(existsSync(indexPath)).toBe(true)
  })

  it('hot 压到阈值以内（17 轮 → 压 10 留 7，产 2 条 warm）', async () => {
    for (let i = 0; i < 17; i++) db.insertTurn(i % 2 ? 'pet' : 'user', `轮次${i}`, 1000 + i)
    const report = await runDream(makeDeps())
    expect(report.hotCompacted).toBe(10)
    expect(db.hotCount()).toBe(7)
    expect(db.hotCount()).toBeLessThanOrEqual(HOT_COMPACT_THRESHOLD)
    expect(db.warmCount()).toBe(2)
  })

  it('warm 合并到阈值以内并落 cold', async () => {
    for (let i = 0; i < 8; i++) {
      db.insertWarm({ turnStart: i, turnEnd: i, summary: `段${i}`, topics: ['work'], t: 1000 + i })
    }
    const report = await runDream(makeDeps())
    expect(report.warmMerged).toBe(5)
    expect(db.warmCount()).toBe(3)
    expect(db.warmCount()).toBeLessThanOrEqual(WARM_MERGE_THRESHOLD)
    expect(cold.list()).toHaveLength(1)
    expect(cold.list()[0]!.topic).toBe('work')
  })

  it('cold 精确重复合并：保 lastT 最新，settings 来源不动', async () => {
    seedCold('dup-old', '喜欢喝美式', '2026-01-01T00:00:00Z')
    seedCold('dup-new', '喜欢喝美式', '2026-06-01T00:00:00Z')
    seedCold('dup-settings', '喜欢喝美式', '2025-01-01T00:00:00Z', 'settings')
    seedCold('other', '养了一只猫', '2026-03-01T00:00:00Z')
    const report = await runDream(makeDeps())
    expect(report.coldMergedDupes).toBe(1)
    const names = cold.list().map((c) => c.name).sort()
    expect(names).toEqual(['dup-new', 'dup-settings', 'other'])
  })

  it('cold 超 200 条按 lastT 淘汰最老，settings 永不淘汰', async () => {
    // 3 条最老的是 settings（受保护），再放 COLD_MAX_ITEMS+2 条普通项
    for (let i = 0; i < 3; i++) {
      seedCold(`keep-settings-${i}`, `手编${i}`, `2020-01-0${i + 1}T00:00:00Z`, 'settings', `s${i}`)
    }
    for (let i = 0; i < COLD_MAX_ITEMS + 2; i++) {
      seedCold(`item-${String(i).padStart(3, '0')}`, `事实${i}`, new Date(1700000000000 + i * 60_000).toISOString(), 'chat', `t${i}`)
    }
    const report = await runDream(makeDeps())
    expect(report.coldEvicted).toBe(5)   // 3(settings 占额) + 2(纯超量)，全部从普通项里出
    expect(cold.list()).toHaveLength(COLD_MAX_ITEMS)
    const names = cold.list().map((c) => c.name)
    expect(names).toContain('keep-settings-0')
    expect(names).not.toContain('item-000')   // 最老普通项被淘汰
    expect(names).not.toContain('item-004')
    expect(names).toContain('item-005')
  })

  it('MEMORY.md 重建包含现存条目', async () => {
    seedCold('index-me', '记住这条', '2026-06-01T00:00:00Z')
    await runDream(makeDeps())
    expect(readFileSync(indexPath, 'utf8')).toContain('index-me')
  })
})

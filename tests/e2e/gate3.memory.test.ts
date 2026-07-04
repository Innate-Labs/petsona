// M1 Gate ③：重启 App，hot/warm/cold 记忆存活并可 callback

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { HarnessProc } from '../helpers/harness.js'
import { startMockGateway } from '../helpers/mock_gateway.js'
import { SessionsDb } from '../../packages/harness/src/memory/sqlite.js'
import { ColdFs } from '../../packages/harness/src/memory/coldfs.js'
import { LocalMemoryStore } from '../../packages/harness/src/memory/store.js'
import { GatewayClient } from '../../packages/harness/src/gateway/client.js'

const servers: Server[] = []
const procs: HarnessProc[] = []
afterAll(() => {
  for (const p of procs) p.kill()
  for (const s of servers) s.close()
})

describe('Gate ③（单元层）：三层记忆跨实例存活 + 压缩触发', () => {
  it('hot>10 压 warm、warm 可检索、cold 文件重开可读、assemble 可 callback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'petsona-gate3-store-'))
    const dbPath = join(dir, 'sessions.db')
    const coldDir = join(dir, 'cold')
    const idxPath = join(dir, 'MEMORY.md')
    const offline = new GatewayClient('http://127.0.0.1:9')   // 摘要走截断兜底，不依赖网络

    // 第一个实例：写 12 轮 → 触发 hot→warm；写一条 cold
    {
      const db = new SessionsDb(dbPath)
      const store = new LocalMemoryStore(db, new ColdFs(coldDir, idxPath), offline)
      for (let i = 0; i < 12; i++) {
        const id = db.insertTurn(i % 2 ? 'pet' : 'user', `第${i}句：聊到了咖啡豆偏好`, Date.now() + i)
        db.setTurnTopics(id, ['pref.coffee'])
      }
      await store.compactIfNeeded()
      store.remember('只喝手冲，讨厌速溶', 'preference', 'chat')
      expect(db.hotCount()).toBeLessThanOrEqual(10)     // 压掉最老 5 轮
      expect(db.warmCount()).toBe(1)
      db.close()
    }

    // 第二个实例（=重启）：三层都在，assemble 能召回
    {
      const db = new SessionsDb(dbPath)
      const cold = new ColdFs(coldDir, idxPath)
      const store = new LocalMemoryStore(db, cold, offline)
      expect(db.hotCount()).toBeGreaterThan(0)                       // hot 存活
      expect(db.warmCount()).toBe(1)                                 // warm 存活
      expect(cold.list().some((c) => c.body.includes('手冲'))).toBe(true)  // cold 存活
      const mem = store.assemble(['pref.coffee', 'pref'])
      expect(mem.recentHot.length).toBeGreaterThan(0)
      expect(mem.cold.some((c) => c.body.includes('手冲'))).toBe(true)     // callback 数据可达
      db.close()
    }
  })
})

describe('Gate ③（进程层）：harness 重启后对话历史可回读', () => {
  it('chat → kill → 重启 → CHAT_HISTORY_GET 含上一进程的轮次', async () => {
    const gw = await startMockGateway({ chatReply: '记住啦，你喜欢手冲咖啡！' })
    servers.push(gw.server)
    const dataDir = mkdtempSync(join(tmpdir(), 'petsona-gate3-proc-'))

    const h1 = new HarnessProc({ PETSONA_DATA_DIR: dataDir, PETSONA_GATEWAY_URL: gw.url })
    procs.push(h1)
    const { turnId } = await h1.request('CHAT_SEND', { text: '我只喝手冲咖啡' })
    await h1.waitFor((e) => e.type === 'CHAT_DONE' && e.payload?.turnId === turnId, 15_000)
    h1.kill()
    await h1.waitExit()

    const h2 = new HarnessProc({ PETSONA_DATA_DIR: dataDir, PETSONA_GATEWAY_URL: gw.url })
    procs.push(h2)
    const { turns } = await h2.request('CHAT_HISTORY_GET', { limit: 20 })
    expect(turns.some((t: any) => t.text.includes('手冲咖啡'))).toBe(true)   // 重启存活
    h2.kill()
  })
})

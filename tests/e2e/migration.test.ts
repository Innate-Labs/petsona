// H10 匿名→登录目录迁移端到端：LOGIN_SUBMIT 记账 → 重启 harness → anon 目录搬到 user- 下
import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { createHash } from 'node:crypto'
import { HarnessProc } from '../helpers/harness.js'
import { startMockGateway } from '../helpers/mock_gateway.js'

const servers: Server[] = []
const procs: HarnessProc[] = []

afterAll(() => {
  for (const p of procs) p.kill()
  for (const s of servers) s.close()
})

const uidFor = (email: string) =>
  `user-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12)}`

describe('H10 匿名→登录目录迁移 e2e', () => {
  it('login 记账 pending，重启后 anon 数据搬到 user- 目录', async () => {
    const gw = await startMockGateway()
    servers.push(gw.server)

    const dataDir = mkdtempSync(join(tmpdir(), 'petsona-mig-e2e-'))
    // deviceId 固定，anon 目录可预测
    writeFileSync(join(dataDir, 'device.json'), JSON.stringify({ deviceId: 'mige2e' }))

    const env: Record<string, string> = {
      PETSONA_DATA_DIR: dataDir,
      PETSONA_GATEWAY_URL: gw.url,
    }

    // ---- 第一次启动：anon 起来，写点记忆 ----
    let proc = new HarnessProc(env)
    procs.push(proc)
    await proc.request('PING', {})
    // 存一条 settings 记忆（下一轮启动后要能读到）
    const seedPath = join(dataDir, 'anon-mige2e/memory/cold/pref-e2e-seed.md')
    writeFileSync(seedPath, [
      '---', 'name: pref-e2e-seed', 'type: preference', 'topic: pref',
      'source: settings', 'lastT: 2026-07-03T00:00:00Z', '---', '喜欢喝手冲', '',
    ].join('\n'))

    const email = 'migrate@e2e.test'
    await proc.request('LOGIN_SUBMIT', { email, code: '888888' })
    // 记账立刻落盘
    expect(existsSync(join(dataDir, 'pending-migration.json'))).toBe(true)
    // 面板收到重启提示（借道 REMINDER_FIRED）
    const fired = await proc.waitFor(
      (e) => e.type === 'REMINDER_FIRED' && e.payload?.phase === 'restart_to_migrate',
      5000,
    )
    expect(fired.payload.petLine).toContain('账号')

    proc.kill()
    await proc.waitExit()

    // ---- 第二次启动：applyPending 落地迁移 ----
    proc = new HarnessProc(env)
    procs.push(proc)
    await proc.request('PING', {})

    expect(existsSync(join(dataDir, 'pending-migration.json'))).toBe(false)
    expect(existsSync(join(dataDir, 'anon-mige2e'))).toBe(false)

    const targetUid = uidFor(email)
    expect(existsSync(join(dataDir, targetUid, 'memory/cold/pref-e2e-seed.md'))).toBe(true)

    // 从新目录能拿到迁移过来的记忆
    const list = await proc.request('MEMORY_LIST_GET', {})
    expect(list.items.some((m: any) => m.name === 'pref-e2e-seed')).toBe(true)

    // dataRoot 顶层没有留下多余 pending 或 anon-* 目录
    const topLevel = readdirSync(dataDir)
    expect(topLevel).toContain(targetUid)
    expect(topLevel.every((n) => !n.startsWith('anon-'))).toBe(true)
  }, 30_000)
})

// 记忆管理 IPC 面（M3 记忆管理页后端）：LIST 回 gist、GET 回全文、EDIT 仅 settings、DELETE/CLEAR 即时生效
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessProc } from '../helpers/harness.js'

let proc: HarnessProc
const UID = 'anon-meme2e'
const LONG_BODY = '这是一条超过四十个字符的完整记忆内容，用来验证 LIST 的 gist 截断与 GET 的全文返回不是同一个东西。'

function coldFile(name: string, type: string, source: string, body: string): string {
  return `---\nname: ${name}\ntype: ${type}\ntopic: test\nsource: ${source}\nlastT: 2026-07-01T00:00:00Z\n---\n${body}\n`
}

beforeAll(() => {
  const dataDir = mkdtempSync(join(tmpdir(), 'petsona-mem-e2e-'))
  writeFileSync(join(dataDir, 'device.json'), JSON.stringify({ deviceId: 'meme2e' }))
  const coldDir = join(dataDir, UID, 'memory/cold')
  mkdirSync(coldDir, { recursive: true })
  writeFileSync(join(coldDir, 'fact-long.md'), coldFile('fact-long', 'fact', 'chat', LONG_BODY))
  writeFileSync(join(coldDir, 'profile-editable.md'), coldFile('profile-editable', 'profile', 'settings', '可编辑画像'))
  proc = new HarnessProc({ PETSONA_DATA_DIR: dataDir })
})

afterAll(() => proc.kill())

describe('记忆管理 IPC', () => {
  it('LIST 回 gist（截断），GET 回完整 body', async () => {
    const list = await proc.request('MEMORY_LIST_GET', {})
    expect(list.items).toHaveLength(2)
    const meta = list.items.find((m: any) => m.name === 'fact-long')
    expect(meta.gist.length).toBeLessThan(LONG_BODY.length)
    const got = await proc.request('MEMORY_GET', { name: 'fact-long' })
    expect(got.item.body).toBe(LONG_BODY)
  })
  it('GET 不存在 → BAD_REQUEST', async () => {
    await expect(proc.request('MEMORY_GET', { name: 'nope' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('EDIT 仅 settings 来源可改，chat 来源 PERMISSION_DENIED', async () => {
    await proc.request('MEMORY_EDIT', { name: 'profile-editable', body: '改过的画像' })
    const got = await proc.request('MEMORY_GET', { name: 'profile-editable' })
    expect(got.item.body).toBe('改过的画像')
    await expect(proc.request('MEMORY_EDIT', { name: 'fact-long', body: 'x' }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
  it('DELETE 即时生效，CLEAR 按分类清空', async () => {
    await proc.request('MEMORY_DELETE', { name: 'fact-long' })
    const afterDel = await proc.request('MEMORY_LIST_GET', {})
    expect(afterDel.items.map((m: any) => m.name)).toEqual(['profile-editable'])
    const cleared = await proc.request('MEMORY_CLEAR', { scope: 'profile' })
    expect(cleared.cleared).toBe(1)
    const afterClear = await proc.request('MEMORY_LIST_GET', {})
    expect(afterClear.items).toHaveLength(0)
  })
})

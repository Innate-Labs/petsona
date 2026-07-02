// 工具契约测试（§10）：每个轻工具的权限级 / 行为 / 截断各 1 条

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { ToolRegistry } from '../../packages/harness/src/tools/registry.js'
import { registerLightTools } from '../../packages/harness/src/tools/light/index.js'
import { resolvePaths } from '../../packages/harness/src/paths.js'
import { SessionsDb } from '../../packages/harness/src/memory/sqlite.js'
import { ColdFs } from '../../packages/harness/src/memory/coldfs.js'
import { LocalMemoryStore } from '../../packages/harness/src/memory/store.js'
import { GatewayClient } from '../../packages/harness/src/gateway/client.js'
import { SkillLoader } from '../../packages/harness/src/skills/loader.js'
import { makePersistLargeHook } from '../../packages/harness/src/hooks/pre/tooluse.js'
import { DEFAULT_CONFIG, IPC, LIGHT_TOOLS } from '@petsona/shared'
import { TaskBoard } from '../../packages/harness/src/tasks/board.js'

// §3.6 轻工具默认级契约
const EXPECTED_LEVELS: Record<string, string> = {
  recall_memory: 'L0', remember: 'L0', set_emotion: 'L0', read_context: 'L0',
  schedule_reminder: 'L0', dispatch_task: 'L1', check_task: 'L0', load_skill: 'L0',
}

let reg: ToolRegistry
let events: { type: string; payload: unknown }[] = []
let paths: ReturnType<typeof resolvePaths>

beforeAll(() => {
  process.env.PETSONA_DATA_DIR = mkdtempSync(join(tmpdir(), 'petsona-tools-'))
  paths = resolvePaths('test-user')
  const db = new SessionsDb(paths.sessionsDb)
  const cold = new ColdFs(paths.coldDir, paths.memoryIndex)
  const gateway = new GatewayClient('http://127.0.0.1:1')   // 不可达：工具不应依赖网络
  const store = new LocalMemoryStore(db, cold, gateway)
  const taskBoard = new TaskBoard({
    tasksDir: paths.tasksDir,
    getConfig: () => DEFAULT_CONFIG,
    emit: (e) => events.push(e),
  })
  reg = new ToolRegistry('companion')
  registerLightTools(reg, {
    store,
    skills: new SkillLoader(paths.skills),
    paths,
    taskBoard,
    emit: (e) => events.push(e),
    sysState: { accessibility: false },
  })
})

describe('轻工具注册契约（§3.6 表）', () => {
  it('8 个轻工具全部注册且名单精确匹配', () => {
    expect(new Set(reg.names())).toEqual(new Set(LIGHT_TOOLS))
  })

  it('默认权限级与规格一致', () => {
    for (const name of LIGHT_TOOLS) {
      expect(reg.get(name)!.defaultLevel, name).toBe(EXPECTED_LEVELS[name])
    }
  })

  it('description ≤200 字符（控制常驻 token）', () => {
    for (const name of reg.names()) {
      expect(reg.get(name)!.description.length).toBeLessThanOrEqual(200)
    }
  })
})

describe('轻工具行为契约', () => {
  const ctx = () => ({ dataDir: paths.root, emit: (e: any) => events.push(e), gateway: null })

  it('remember 写 cold 文件并重建 MEMORY.md 索引', async () => {
    const out = (await reg.get('remember')!.handler({ fact: '喜欢温柔口吻', type: 'preference' }, ctx() as any)) as { name: string }
    expect(existsSync(join(paths.coldDir, `${out.name}.md`))).toBe(true)
    expect(readFileSync(paths.memoryIndex, 'utf8')).toContain(out.name)
  })

  it('recall_memory 命中 remember 写入的条目', async () => {
    const out = (await reg.get('recall_memory')!.handler({ topic: 'pref' }, ctx() as any)) as string
    expect(out).toContain('温柔口吻')
  })

  it('set_emotion 发出 PET_EMOTION_SIGNAL 事件', async () => {
    events = []
    await reg.get('set_emotion')!.handler({ state: 'happy', cause: '测试' }, ctx() as any)
    expect(events.some((e) => e.type === 'PET_EMOTION_SIGNAL')).toBe(true)
  })

  it('read_context 无 Accessibility 权限 → OS_PERMISSION_MISSING', async () => {
    const out = (await reg.get('read_context')!.handler({}, ctx() as any)) as { error?: string }
    expect(out.error).toBe('OS_PERMISSION_MISSING')
  })

  it('schedule_reminder 持久化 scheduled.json 并返回 jobId', async () => {
    const out = (await reg.get('schedule_reminder')!.handler({ kind: 'water' }, ctx() as any)) as { jobId: string }
    expect(out.jobId).toMatch(/^job_/)
    const jobs = JSON.parse(readFileSync(paths.scheduled, 'utf8'))
    expect(jobs.some((j: any) => j.id === out.jobId)).toBe(true)
  })

  it('dispatch_task 派发任务、落盘并广播 TASK_EVENT', async () => {
    events = []
    const out = (await reg.get('dispatch_task')!.handler(
      { goal: '整理下载', agentType: 'worker', scope: { dirs: ['~/Downloads'], net: false } }, ctx() as any,
    )) as { taskId: string; status: string }
    expect(out.taskId).toMatch(/^task_/)
    expect(out.status).toBe('queued')
    expect(existsSync(join(paths.tasksDir, `${out.taskId}.json`))).toBe(true)
    expect(events.some((e) => e.type === IPC.TASK_EVENT && (e.payload as any).t === 'created')).toBe(true)
  })

  it('check_task 未知任务 → found:false（不抛错）', async () => {
    const out = (await reg.get('check_task')!.handler({ taskId: 'task_nope' }, ctx() as any)) as { found: boolean }
    expect(out.found).toBe(false)
  })

  it('load_skill 返回 <skill> 包裹；不存在时不泄露路径', async () => {
    const out = (await reg.get('load_skill')!.handler({ name: 'no_such_skill' }, ctx() as any)) as string
    expect(out).toContain('<skill')
    expect(out).not.toContain(paths.root)
  })

  it('load_skill 拒绝目录穿越', async () => {
    const out = (await reg.get('load_skill')!.handler({ name: '../../etc' }, ctx() as any)) as string
    expect(out).toContain('不合法')
  })
})

describe('截断行为契约（PostToolUse persist_large）', () => {
  it('>30K 输出落盘 outputs/ 并截断回传', async () => {
    const hook = makePersistLargeHook(paths.outputsDir)
    const big = 'x'.repeat(40_000)
    const out = await hook({ tool: 'recall_memory', input: {} }, big)
    expect(out.length).toBeLessThan(3000)
    expect(out).toContain('已落盘')
  })

  it('≤30K 输出原样回传', async () => {
    const hook = makePersistLargeHook(paths.outputsDir)
    const small = 'y'.repeat(100)
    expect(await hook({ tool: 'recall_memory', input: {} }, small)).toBe(small)
  })
})

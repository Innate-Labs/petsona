// 8 个轻工具（loop=companion，§3.6）——低延迟、无/极小副作用
// dispatch_task M1 占位：返回「M2 才会干活喵」（v3.0 A.3 本轮范围）

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CronJob, Emotion, ToolDef } from '@petsona/shared'
import { IPC } from '@petsona/shared'
import type { LocalMemoryStore } from '../../memory/store.js'
import type { SkillLoader } from '../../skills/loader.js'
import type { DataPaths } from '../../paths.js'
import { wrapExternal } from '../../hooks/pre/injection_guard.js'
import { ToolRegistry } from '../registry.js'

const execFileAsync = promisify(execFile)

export type LightToolDeps = {
  store: LocalMemoryStore
  skills: SkillLoader
  paths: DataPaths
  emit: (event: { type: string; payload: unknown }) => void
  sysState: { accessibility: boolean }    // SYS_PERMISSION_STATE 镜像
}

export function registerLightTools(reg: ToolRegistry, deps: LightToolDeps): void {
  const defs: ToolDef[] = [
    {
      name: 'recall_memory',
      description: '按话题检索记忆（warm/cold 层）。想不起旧事时先用这个。',
      inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async (input: { topic: string }) => JSON.stringify(deps.store.recall(String(input.topic ?? ''))),
    },
    {
      name: 'remember',
      description: '把用户的长期偏好/事实写入冷记忆。type ∈ preference|fact|emotion|profile|meme。',
      inputSchema: {
        type: 'object',
        properties: { fact: { type: 'string' }, type: { type: 'string', enum: ['preference', 'fact', 'emotion', 'profile', 'meme'] } },
        required: ['fact', 'type'],
      },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async (input: { fact: string; type: any }) =>
        ({ name: deps.store.remember(String(input.fact), input.type ?? 'fact', 'chat').name }),
    },
    {
      name: 'set_emotion',
      description: '切换宠物情绪表情。state ∈ happy|angry|sad|anxious|calm|unknown。一轮最多一次。',
      inputSchema: {
        type: 'object',
        properties: { state: { type: 'string' }, cause: { type: 'string' } },
        required: ['state', 'cause'],
      },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async (input: { state: Emotion; cause: string }) => {
        deps.emit({ type: IPC.PET_EMOTION_SIGNAL, payload: { state: input.state, cause: input.cause } })
        return 'ok'
      },
    },
    {
      name: 'read_context',
      description: '读取当前桌面上下文：前台 App、窗口标题、剪贴板。回答「帮我看看这个」类问题用。',
      inputSchema: { type: 'object', properties: {} },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async () => readDesktopContext(deps.sysState.accessibility),
    },
    {
      name: 'schedule_reminder',
      description: '设置提醒。kind ∈ pomodoro|water|stand|custom；cron 为 5 段表达式（可选）。',
      inputSchema: {
        type: 'object',
        properties: { kind: { type: 'string' }, cron: { type: 'string' }, note: { type: 'string' } },
        required: ['kind'],
      },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async (input: { kind: string; cron?: string; note?: string }) => {
        // M1：只持久化到 scheduled.json（类型齐备）；调度线程 M3 交付（v3.0 A.3）
        const job: CronJob = {
          id: `job_${randomUUID().slice(0, 8)}`,
          cron: input.cron ?? defaultCron(input.kind),
          kind: (['pomodoro', 'water', 'stand', 'dream', 'anniversary'].includes(input.kind) ? input.kind : 'custom') as CronJob['kind'],
          payload: input.note ? { note: input.note } : undefined,
          durable: true,
        }
        const jobs = readJobs(deps.paths.scheduled)
        jobs.push(job)
        writeFileSync(deps.paths.scheduled, JSON.stringify(jobs, null, 2))
        return { jobId: job.id }
      },
    },
    {
      name: 'dispatch_task',
      description: '把需要动文件/跑命令的重活派给干活子 Agent。goal 写清目标与成功标准。',
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string' },
          agentType: { type: 'string', enum: ['explore', 'worker'] },
          scope: { type: 'object', properties: { dirs: { type: 'array', items: { type: 'string' } }, net: { type: 'boolean' } } },
          skill: { type: 'string' },
        },
        required: ['goal', 'agentType', 'scope'],
      },
      loop: 'companion',
      defaultLevel: 'L1',
      handler: async () => ({ taskId: 'task_m2_placeholder', note: 'M2 才会干活喵' }),
    },
    {
      name: 'check_task',
      description: '查询已派发任务的状态与进度。',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async (input: { taskId: string }) => {
        if (!/^[\w-]+$/.test(input.taskId)) return { found: false }
        const p = join(deps.paths.tasksDir, `task_${input.taskId.replace(/^task_/, '')}.json`)
        if (!existsSync(p)) return { found: false, note: '没有这个任务（M2 后任务才会真实落盘）' }
        const rec = JSON.parse(readFileSync(p, 'utf8'))
        return { found: true, status: rec.status, goal: rec.goal, usage: rec.usage }
      },
    },
    {
      name: 'load_skill',
      description: '按名加载技能说明书正文（SKILL.md）。技能目录见 system prompt 的 skill-index。',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      loop: 'companion',
      defaultLevel: 'L0',
      handler: async (input: { name: string }) => deps.skills.load(String(input.name)),
    },
  ]
  for (const def of defs) reg.register(def)
}

function readJobs(path: string): CronJob[] {
  if (!existsSync(path)) return []
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function defaultCron(kind: string): string {
  // SPEC-GAP: 未给各 kind 默认 cron，按 Config 默认周期折算
  switch (kind) {
    case 'water': return '0 * * * *'
    case 'stand': return '*/45 * * * *'
    case 'pomodoro': return '*/25 * * * *'
    default: return '0 9 * * *'
  }
}

async function readDesktopContext(accessibility: boolean): Promise<object> {
  // 无 Accessibility 权限 → OS_PERMISSION_MISSING（§3.6）；harness 侧读 SYS_PERMISSION_STATE 镜像
  if (!accessibility) {
    return { error: 'OS_PERMISSION_MISSING', hint: '需要辅助功能权限才能看到屏幕上下文' }
  }
  try {
    const [appRes, clipRes] = await Promise.allSettled([
      execFileAsync('/usr/bin/osascript', ['-e',
        'tell application "System Events" to get name of first process whose frontmost is true']),
      execFileAsync('/usr/bin/pbpaste'),
    ])
    const app = appRes.status === 'fulfilled' ? appRes.value.stdout.trim() : 'unknown'
    const clipboard = clipRes.status === 'fulfilled' ? clipRes.value.stdout.slice(0, 2000) : undefined
    // SPEC-GAP: M1 无窗口标题与选中文字（需 AX API，随 M2 屏幕问答一起做）；外部内容过 injection guard
    return { app, windowTitle: '', clipboard: clipboard ? wrapExternal(clipboard) : undefined }
  } catch {
    return { error: 'OS_PERMISSION_MISSING', hint: '读取桌面上下文失败，可能未授权' }
  }
}

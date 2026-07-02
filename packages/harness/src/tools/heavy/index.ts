// M2 子 Agent 重工具：只注册在 subagent registry，经 permission/scope/audit hooks 后执行。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { ToolCtx, ToolDef } from '@petsona/shared'
import { IPC, TOOL_OUTPUT_TRUNCATE } from '@petsona/shared'
import type { ToolRegistry } from '../registry.js'
import type { DataPaths } from '../../paths.js'
import type { StagingStore } from '../../staging/store.js'
import type { GatewayClient } from '../../gateway/client.js'
import { wrapExternal } from '../../hooks/pre/injection_guard.js'

const execFileAsync = promisify(execFile)
const DEFAULT_READ_LIMIT = TOOL_OUTPUT_TRUNCATE

export type HeavyToolDeps = {
  paths: DataPaths
  staging?: StagingStore
}

export function registerHeavyTools(reg: ToolRegistry, deps: HeavyToolDeps): void {
  const defs: ToolDef[] = [
    {
      name: 'fs_read',
      description: '读取 scope 内文本文件。输入 path，可选 maxBytes。',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, maxBytes: { type: 'number' } },
        required: ['path'],
      },
      loop: 'subagent',
      defaultLevel: 'L0',
      handler: async (input, ctx) => {
        const path = resolveTaskPath(String(input?.path ?? ''), ctx)
        const maxBytes = Math.min(Number(input?.maxBytes ?? DEFAULT_READ_LIMIT), DEFAULT_READ_LIMIT)
        const buf = readFileSync(path)
        return buf.subarray(0, maxBytes).toString('utf8')
      },
    },
    {
      name: 'fs_glob',
      description: '列出 scope 内文件。输入 cwd 与 pattern，默认 **/*。',
      inputSchema: {
        type: 'object',
        properties: { cwd: { type: 'string' }, pattern: { type: 'string' }, maxEntries: { type: 'number' } },
      },
      loop: 'subagent',
      defaultLevel: 'L0',
      handler: async (input, ctx) => {
        const cwd = resolveTaskPath(String(input?.cwd ?? ctx.scope?.dirs[0] ?? '.'), ctx)
        const pattern = String(input?.pattern ?? '**/*')
        const maxEntries = Math.min(Number(input?.maxEntries ?? 200), 1000)
        return { files: globFiles(cwd, pattern, maxEntries) }
      },
    },
    {
      name: 'fs_write',
      description: '写入 scope 内文件。输入 path、content，可选 append。',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
        required: ['path', 'content'],
      },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (input, ctx) => {
        const path = resolveTaskPath(String(input?.path ?? ''), ctx)
        if (deps.staging && ctx.taskId) {
          const op = deps.staging.stageWrite(ctx.taskId, path, String(input?.content ?? ''), Boolean(input?.append))
          return { staged: true, opId: op.opId, path, bytes: op.op === 'write' ? op.bytes : 0 }
        }
        mkdirSync(dirname(path), { recursive: true })
        const previous = existsSync(path) ? readFileSync(path, 'utf8') : ''
        writeFileSync(path, input?.append ? `${previous}${String(input?.content ?? '')}` : String(input?.content ?? ''))
        return { ok: true, path, bytes: statSync(path).size }
      },
    },
    {
      name: 'fs_move',
      description: '移动 scope 内文件。输入 from、to。',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (input, ctx) => {
        const from = resolveTaskPath(String(input?.from ?? ''), ctx)
        const to = resolveTaskPath(String(input?.to ?? ''), ctx)
        if (deps.staging && ctx.taskId) {
          const op = deps.staging.stageMove(ctx.taskId, 'move', from, to)
          return { staged: true, opId: op.opId, from, to }
        }
        mkdirSync(dirname(to), { recursive: true })
        renameSync(from, to)
        return { ok: true, from, to }
      },
    },
    {
      name: 'fs_rename',
      description: '重命名 scope 内文件。输入 from、to。',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (input, ctx) => {
        const from = resolveTaskPath(String(input?.from ?? ''), ctx)
        const to = resolveTaskPath(String(input?.to ?? ''), ctx)
        if (deps.staging && ctx.taskId) {
          const op = deps.staging.stageMove(ctx.taskId, 'rename', from, to)
          return { staged: true, opId: op.opId, from, to }
        }
        mkdirSync(dirname(to), { recursive: true })
        renameSync(from, to)
        return { ok: true, from, to }
      },
    },
    {
      name: 'fs_trash',
      description: '将 scope 内文件移入 Petsona 本地任务回收站。输入 path。',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (input, ctx) => {
        const path = resolveTaskPath(String(input?.path ?? ''), ctx)
        if (deps.staging && ctx.taskId) {
          const op = deps.staging.stageTrash(ctx.taskId, path)
          return { staged: true, opId: op.opId, path }
        }
        const trashDir = join(deps.paths.root, 'trash', ctx.taskId ?? 'manual')
        mkdirSync(trashDir, { recursive: true })
        const target = join(trashDir, `${Date.now()}_${path.split('/').pop() || 'item'}`)
        renameSync(path, target)
        return { ok: true, path, trashPath: target }
      },
    },
    {
      name: 'shell',
      description: '在 scope 内 cwd 执行命令。输入 cmd、cwd；禁止 sudo/rm/keychain。',
      inputSchema: {
        type: 'object',
        properties: { cmd: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } },
        required: ['cmd'],
      },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (input, ctx) => {
        const cmd = String(input?.cmd ?? '')
        if (!ctx.scope?.net && /\b(curl|wget|git\s+(clone|pull|fetch)|npm\s+i|pnpm\s+i|pip\s+install)\b/.test(cmd)) {
          throw new Error('此任务未授权联网命令')
        }
        const cwd = resolveTaskPath(String(input?.cwd ?? ctx.scope?.dirs[0] ?? '.'), ctx)
        const timeout = Math.min(Number(input?.timeoutMs ?? 30_000), 120_000)
        const res = await execFileAsync('/bin/zsh', ['-lc', cmd], { cwd, timeout, maxBuffer: 2_000_000 })
        return trimOutput(`stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
      },
    },
    {
      name: 'applescript',
      description: '执行只读 AppleScript。发消息/邮件等自动替用户操作会被内置规则禁止。',
      inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] },
      loop: 'subagent',
      defaultLevel: 'L2',
      handler: async (input) => {
        const res = await execFileAsync('/usr/bin/osascript', ['-e', String(input?.script ?? '')], { timeout: 15_000 })
        return trimOutput(res.stdout || res.stderr)
      },
    },
    {
      name: 'screenshot',
      description: '截屏保存到任务输出目录。需要系统屏幕录制权限。',
      inputSchema: { type: 'object', properties: {} },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (_input, ctx) => {
        const dir = join(deps.paths.outputsDir, ctx.taskId ?? 'manual')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, `screenshot_${Date.now()}.png`)
        await execFileAsync('/usr/sbin/screencapture', ['-x', path], { timeout: 15_000 })
        return { ok: true, path }
      },
    },
    {
      name: 'web_fetch',
      description: '联网读取 URL 文本内容。输入 url，可选 maxBytes。任务未授权联网（net=false）时会被拦截。',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, maxBytes: { type: 'number' } },
        required: ['url'],
      },
      loop: 'subagent',
      defaultLevel: 'L1',
      handler: async (input, ctx: ToolCtx) => {
        // 缝①：联网只经 GatewayClient 代理；网页属外部内容，必须 <data> 包裹再入上下文（§6）
        const gateway = ctx.gateway as GatewayClient
        const res = await gateway.proxyFetch(String(input?.url ?? ''), numberOrUndef(input?.maxBytes))
        return {
          ok: res.ok,
          status: res.status,
          contentType: res.contentType,
          finalUrl: res.finalUrl,
          truncated: res.truncated,
          content: wrapExternal(res.text),
        }
      },
    },
    {
      name: 'todo_write',
      description: '记录子任务 TODO 状态。输入 items 数组。',
      inputSchema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] },
      loop: 'subagent',
      defaultLevel: 'L0',
      handler: async (input, ctx) => {
        const dir = join(deps.paths.outputsDir, ctx.taskId ?? 'manual')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, 'todo.json')
        writeFileSync(path, JSON.stringify(input?.items ?? [], null, 2))
        const note = Array.isArray(input?.items) ? `${input.items.length} 个 TODO` : 'TODO 已更新'
        ctx.emit({ type: IPC.TASK_EVENT, payload: { t: 'progress', taskId: ctx.taskId, note } })
        return { ok: true, path }
      },
    },
    {
      name: 'report_progress',
      description: '向任务板报告进度。输入 note，30 字以内最好。',
      inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      loop: 'subagent',
      defaultLevel: 'L0',
      handler: async (input, ctx) => {
        const note = String(input?.note ?? '').slice(0, 30)
        ctx.emit({ type: IPC.TASK_EVENT, payload: { t: 'progress', taskId: ctx.taskId, note } })
        return { ok: true }
      },
    },
  ]
  for (const def of defs) reg.register(def)
}

function resolveTaskPath(raw: string, ctx: ToolCtx): string {
  if (!raw.trim()) throw new Error('path 必填')
  const expanded = raw.startsWith('~') ? `${homedir()}${raw.slice(1)}` : raw
  const base = ctx.scope?.dirs[0] ? expandPath(ctx.scope.dirs[0]) : process.cwd()
  return resolve(isAbsolute(expanded) ? expanded : join(base, expanded))
}

function expandPath(path: string): string {
  return path.startsWith('~') ? `${homedir()}${path.slice(1)}` : path
}

function globFiles(cwd: string, pattern: string, maxEntries: number): string[] {
  const out: string[] = []
  const matcher = globToRegExp(pattern)
  const walk = (dir: string) => {
    if (out.length >= maxEntries) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') continue
      const path = join(dir, name)
      const rel = relative(cwd, path).replace(/\\/g, '/')
      const st = lstatSync(path)
      if (matcher.test(rel)) out.push(rel)
      if (st.isDirectory() && !st.isSymbolicLink()) walk(path)
      if (out.length >= maxEntries) return
    }
  }
  walk(cwd)
  return out
}

function globToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${esc}$`)
}

function trimOutput(text: string): string {
  return text.length > TOOL_OUTPUT_TRUNCATE ? `${text.slice(0, TOOL_OUTPUT_TRUNCATE)}\n...truncated` : text
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

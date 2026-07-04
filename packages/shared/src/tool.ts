// §3.6 工具注册契约
// SPEC-GAP: §2.2 shared 文件清单未列 tool.ts，但 ToolDef/ToolCtx 属 §3 契约类型，归入 shared

import type { PermissionLevel } from './permission.js'

export type ToolLoop = 'companion' | 'subagent'

// JSONSchema 子集：工具 inputSchema 用（透传给 LLM，不在此强类型化）
export type JSONSchema = Record<string, unknown>

export type ToolCtx = {
  taskId?: string
  scope?: { dirs: string[]; net: boolean }
  dataDir: string
  emit: (event: { type: string; payload: unknown }) => void
  gateway: unknown   // GatewayClient——handler 不得自行发网络请求（缝①），只能经此引用
}

export type ToolDef = {
  name: string
  description: string                          // 给模型看，≤200 字符
  inputSchema: JSONSchema
  loop: ToolLoop                               // 结构性隔离：注册期检查，companion 禁注册 heavy
  defaultLevel: PermissionLevel
  handler: (input: any, ctx: ToolCtx) => Promise<string | object>
}

// 轻工具名单（loop=companion，8 个）——registry 结构性校验依据
export const LIGHT_TOOLS = [
  'recall_memory', 'remember', 'set_emotion', 'read_context',
  'schedule_reminder', 'dispatch_task', 'check_task', 'load_skill',
] as const

// 重工具名单（loop=subagent，M2 实现；M1 仅作 registry 校验黑名单）
export const HEAVY_TOOLS = [
  'fs_read', 'fs_glob', 'fs_write', 'fs_move', 'fs_rename', 'fs_trash',
  'shell', 'applescript', 'screenshot', 'ocr', 'web_fetch', 'todo_write', 'report_progress',
] as const

export type LightToolName = (typeof LIGHT_TOOLS)[number]
export type HeavyToolName = (typeof HEAVY_TOOLS)[number]

export const TOOL_OUTPUT_TRUNCATE = 50_000       // 重工具输出截断 50K
export const TOOL_OUTPUT_PERSIST_THRESHOLD = 30_000  // >30K 落盘 outputs/<taskId>/

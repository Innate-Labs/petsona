// injection_guard（PreTurn 首位）——防桌面 prompt 注入
// M1 stub（v3.0 A.3 允许）：链路走通 + 基础清洗；外部内容 <data> 包裹在工具输出侧执行

import type { PreTurnHook } from '../pipeline.js'

export const injectionGuard: PreTurnHook = async (ctx) => {
  // SPEC-GAP: M1 stub——剥离用户文本里伪装的系统指令标记，完整指令剥离策略 M2 随重工具落地
  ctx.userText = ctx.userText
    .replace(/<\/?(system|assistant|tool_result|instructions)>/gi, '')
    .slice(0, 10_000)
}

/** 外部内容（文件/屏幕/网页/剪贴板）入上下文前必经：<data> 包裹 + 指令剥离（§6 安全） */
export function wrapExternal(content: string): string {
  const stripped = content.replace(/<\/?(system|assistant|instructions)>/gi, '')
  return `<data>\n${stripped}\n</data>`
}

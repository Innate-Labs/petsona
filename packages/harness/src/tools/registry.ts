// §3.6 工具注册表——结构性隔离在注册期强制（不靠 prompt 自觉）
// companion 循环的 registry 注册 heavy 工具 → 直接抛错（§10 结构性约束单测覆盖）

import type { LlmToolDef, ToolDef, ToolLoop } from '@petsona/shared'
import { HEAVY_TOOLS } from '@petsona/shared'

export class ToolRegistry {
  private tools = new Map<string, ToolDef>()

  constructor(public readonly loop: ToolLoop) {}

  register(def: ToolDef): void {
    if (def.loop !== this.loop) {
      throw new Error(`工具 ${def.name} 声明 loop=${def.loop}，不能注册进 ${this.loop} registry`)
    }
    if (this.loop === 'companion' && (HEAVY_TOOLS as readonly string[]).includes(def.name)) {
      throw new Error(`结构性约束违规：companion 循环禁止注册重工具 ${def.name}`)
    }
    if (def.description.length > 200) {
      throw new Error(`工具 ${def.name} description 超 200 字符（控制常驻 token）`)
    }
    this.tools.set(def.name, def)
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  /** 转 LLM 请求的 tools 数组 */
  toLlmTools(): LlmToolDef[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
  }
}

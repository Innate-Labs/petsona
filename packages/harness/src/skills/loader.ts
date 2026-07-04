// s07 技能加载：INDEX.md 常驻 system prompt，SKILL.md 按需热加载
// 热加载 = fs.readFile 每次请求读盘（§2.3）——内容交付不需要重新打包 App

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export class SkillLoader {
  constructor(private skillsDir: string) {}

  readIndex(): string {
    const p = join(this.skillsDir, 'INDEX.md')
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }

  /** load_skill 工具后端：返回 <skill> 包裹的正文；不存在返回提示 */
  load(name: string): string {
    // 防目录穿越：技能名只允许安全字符
    if (!/^[\w-]+$/.test(name)) return `<skill name="${name}">技能名不合法</skill>`
    const p = join(this.skillsDir, name, 'SKILL.md')
    if (!existsSync(p)) return `<skill name="${name}">未找到该技能</skill>`
    return `<skill name="${name}">\n${readFileSync(p, 'utf8')}\n</skill>`
  }
}

// cold 层：memory/cold/<name>.md 一条一文件 + MEMORY.md 索引（≤200 行）
// 人类可读可备份（§2.1 硬约束）；frontmatter 格式见 v3.0 §2.3

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ColdItem, ColdItemMeta, ColdType, ColdSource } from '@petsona/shared'
import { MEMORY_INDEX_MAX_LINES } from '@petsona/shared'

export class ColdFs {
  constructor(private coldDir: string, private indexPath: string) {
    mkdirSync(coldDir, { recursive: true })
  }

  read(name: string): ColdItem | null {
    const p = join(this.coldDir, `${name}.md`)
    if (!existsSync(p)) return null
    return parseColdFile(name, readFileSync(p, 'utf8'))
  }

  list(type?: ColdType): ColdItem[] {
    if (!existsSync(this.coldDir)) return []
    const items: ColdItem[] = []
    for (const f of readdirSync(this.coldDir)) {
      if (!f.endsWith('.md')) continue
      const item = parseColdFile(f.slice(0, -3), readFileSync(join(this.coldDir, f), 'utf8'))
      if (item && (!type || item.type === type)) items.push(item)
    }
    return items
  }

  write(item: ColdItem): void {
    const fm = [
      '---',
      `name: ${item.name}`,
      `type: ${item.type}`,
      `topic: ${item.topic}`,
      `source: ${item.source}`,
      `lastT: ${item.lastT}`,
      '---',
      '',
    ].join('\n')
    writeFileSync(join(this.coldDir, `${item.name}.md`), fm + item.body + '\n')
    this.rebuildIndex()
  }

  /** 删除 = 移入 cold/.trash/（规格禁止任何 rm/直删；$DATA 内清理走移动） */
  remove(name: string): boolean {
    const p = join(this.coldDir, `${name}.md`)
    if (!existsSync(p)) return false
    const trashDir = join(this.coldDir, '.trash')
    mkdirSync(trashDir, { recursive: true })
    renameSync(p, join(trashDir, `${name}.${Date.now()}.md`))
    this.rebuildIndex()
    return true
  }

  byTopic(topic: string, limit: number): ColdItem[] {
    // 前缀匹配：topic=pref 命中 pref.tone（SPEC-GAP: 匹配算法未细化，用前缀+相等）
    return this.list()
      .filter((c) => c.topic === topic || c.topic.startsWith(topic + '.') || topic.startsWith(c.topic + '.'))
      .sort((a, b) => b.lastT.localeCompare(a.lastT))
      .slice(0, limit)
  }

  metas(type?: ColdType): ColdItemMeta[] {
    return this.list(type).map(({ body, ...meta }) => ({ ...meta, gist: gist(body) }))
  }

  /** MEMORY.md：一行一条 `- [name](cold/x.md) — gist 摘要`，≤200 行 */
  rebuildIndex(): void {
    const lines = this.list()
      .sort((a, b) => b.lastT.localeCompare(a.lastT))
      .slice(0, MEMORY_INDEX_MAX_LINES)
      .map((c) => `- [${c.name}](cold/${c.name}.md) — ${gist(c.body)}`)
    writeFileSync(this.indexPath, lines.join('\n') + (lines.length ? '\n' : ''))
  }

  readIndex(): string {
    return existsSync(this.indexPath) ? readFileSync(this.indexPath, 'utf8') : ''
  }
}

function gist(body: string): string {
  const line = body.trim().split('\n')[0] ?? ''
  return line.length > 40 ? line.slice(0, 40) + '…' : line
}

function parseColdFile(name: string, raw: string): ColdItem | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return {
    name: meta.name ?? name,
    type: (meta.type ?? 'fact') as ColdType,
    topic: meta.topic ?? '_untagged',
    source: (meta.source ?? 'chat') as ColdSource,
    lastT: meta.lastT ?? new Date(0).toISOString(),
    body: m[2]!.trim(),
  }
}

/** fact → kebab-case name（type 前缀 + 截断） */
export function coldName(type: ColdType, fact: string): string {
  const slug = fact
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `${type}-${slug || Date.now().toString(36)}`
}

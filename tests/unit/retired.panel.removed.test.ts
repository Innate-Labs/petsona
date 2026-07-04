import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (path.includes('/dist/') || path.includes('/node_modules/')) return []
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

describe('retired panel implementation', () => {
  it('removes the obsolete apps/shell/ui/panel implementation tree', () => {
    expect(existsSync(join(ROOT, 'apps/shell/ui/panel'))).toBe(false)
  })

  it('keeps active UI imports away from the retired panel tree', () => {
    const offenders = walk(join(ROOT, 'apps/shell/ui'))
      .filter((path) => /\.(ts|tsx)$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').includes('./panel/'))
      .map((path) => relative(ROOT, path))

    expect(offenders).toEqual([])
  })
})

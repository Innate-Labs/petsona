import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const main = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')

describe('main panel entry', () => {
  it('keeps the existing ManagementPanel as the main panel entry', () => {
    expect(main).toContain("import { ManagementPanel } from './ManagementPanel'")
    expect(main).toContain("if (view === 'panel') return <ManagementPanel />")
    expect(main).not.toContain("return <Panel />")
  })
})

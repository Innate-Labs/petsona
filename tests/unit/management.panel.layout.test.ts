import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')
const panelSource = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')

function getRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))
  return match?.[1] ?? ''
}

describe('ManagementPanel sidebar layout', () => {
  it('keeps the settings divider flush with the history mask', () => {
    const settingsTabRule = getRule('.panel-settings-tab')

    expect(settingsTabRule).toContain('border-top: 1px solid var(--panel-line);')
    expect(settingsTabRule).toContain('margin-top: -14px;')
  })

  it('uses the reminder delete icon style for history conversation deletion', () => {
    const deleteRule = getRule('.panel-history-delete')
    const deleteImageRule = getRule('.panel-history-delete img')

    expect(panelSource).toContain("import iconDelete from './assets/figma/icon-delete-28.svg'")
    expect(panelSource).toContain('<img src={iconDelete} alt="" />')
    expect(deleteRule).toContain('width: 28px;')
    expect(deleteRule).toContain('height: 28px;')
    expect(deleteImageRule).toContain('width: 100%;')
    expect(deleteImageRule).toContain('height: 100%;')
  })

  it('uses the existing deep brown text color for history conversations', () => {
    const sidebarHistoryRule = getRule('.panel-history-open')
    const historyPageRule = getRule('.panel-history-group button:not(.panel-history-delete)')
    const historyMetaRule = getRule('.panel-history-group small')

    expect(sidebarHistoryRule).toContain('color: var(--panel-ink);')
    expect(historyPageRule).toContain('color: var(--panel-ink);')
    expect(historyMetaRule).toContain('color: color-mix(in srgb, var(--panel-ink) 54%, transparent);')
  })
})

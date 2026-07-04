import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const panel = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')

describe('ManagementPanel route mapping', () => {
  it('maps menu hash routes to the real ManagementPanel tabs', () => {
    expect(panel).toContain('function panelTabFromHash(): PanelTab')
    expect(panel).toContain("case 'data':")
    expect(panel).toContain("return 'petData'")
    expect(panel).toContain("case 'chat':")
    expect(panel).toContain("return 'history'")
    expect(panel).toContain('useState<PanelTab>(panelTabFromHash)')
    expect(panel).toContain('setActiveTab(panelTabFromHash())')
    expect(panel).toContain("window.addEventListener('hashchange', updateActiveTabFromHash)")
  })

  it('renders the real reminders page inside the existing ManagementPanel shell', () => {
    expect(panel).toContain("import { Reminders } from './Reminders'")
    expect(panel).toContain("activeTab === 'reminders'")
    expect(panel).toContain('<Reminders />')
  })
})

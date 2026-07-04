import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const panel = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))?.[1] ?? ''
}

describe('current pet library card', () => {
  it('shows a still first frame until hover starts the animation', () => {
    const start = panel.indexOf('function CurrentPetLibraryCard()')
    const body = panel.slice(start, panel.indexOf('function dateFromKey', start))

    expect(body).toContain('const [hovering, setHovering] = useState(false);')
    expect(body).toContain('className="pet-library-still"')
    expect(body).toContain('src={IDLE_ANIMATION.src}')
    expect(body).toContain('preload="metadata"')
    expect(body).toContain('hovering ? <PetVideoLayer')
    expect(body).not.toContain('const activeAnimation = hovering ? PET_ACTION_SEQUENCE[0] : IDLE_ANIMATION;')
  })

  it('renders the current marker as a dark corner badge', () => {
    const badge = rule('.pet-library-current-badge')

    expect(badge).toContain('position: absolute;')
    expect(badge).toContain('top: 8px;')
    expect(badge).toContain('right: 8px;')
    expect(badge).toContain('background: #3f2a15;')
    expect(badge).toContain('color: #fff7ec;')
    expect(rule('.pet-library-card.current strong')).toBe('')
  })
})

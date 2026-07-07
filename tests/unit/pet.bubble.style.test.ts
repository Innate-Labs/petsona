import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')
const main = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')
const bubbleComponent = readFileSync(join(ROOT, 'apps/shell/ui/pet/Bubble.tsx'), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))?.[1] ?? ''
}

describe('pet bubble style', () => {
  it('uses a solid warm background with a white outline', () => {
    const bubble = rule('.pet-bubble')

    expect(bubble).toContain('top: 2px;')
    expect(bubble).toContain('z-index: 4;')
    expect(bubble).toContain('border: 2px solid #fffaf1;')
    expect(bubble).toContain('color: #4b2b08;')
    expect(bubble).toContain('background: #e5d8c8;')
    expect(bubble).toContain('font: -apple-system-body;')
    expect(bubble).not.toContain('backdrop-filter')
    expect(bubble).not.toContain('-webkit-backdrop-filter')
    expect(bubble).not.toContain('color-mix')
    expect(bubble).not.toContain('-apple-system-control-background')
    expect(rule('.pet-bubble::before')).toBe('')
    expect(rule('.pet-bubble::after')).toBe('')
  })

  it('renders PET_BUBBLE events through the visible pet route', () => {
    expect(main).toContain('type PetBubblePayload')
    expect(main).toContain('on<PetBubblePayload>(IPC.PET_BUBBLE, setBubble)')
    expect(main).toContain('{bubble.text}')
    expect(bubbleComponent).toContain('className={`pet-bubble bubble--${bubble.kind}`}')
  })
})

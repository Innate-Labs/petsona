import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const videoLayer = readFileSync(join(ROOT, 'apps/shell/ui/PetVideoLayer.tsx'), 'utf8')
const petAnimations = readFileSync(join(ROOT, 'apps/shell/ui/petAnimations.ts'), 'utf8')
const mainUi = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')
const panelUi = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')

function constBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  if (start === -1) return ''
  const end = source.indexOf('};', start)
  return source.slice(start, end + 2)
}

describe('pet video autoplay', () => {
  it('loads pet animations from the restored final-pet asset directory', () => {
    expect(petAnimations).toContain("import dragVideo from './assets/characters/final-pet/wave.mov';")
    expect(petAnimations).toContain("import yawnVideo from './assets/characters/final-pet/yawn.mov';")
    expect(petAnimations).toContain("import stretchVideo from './assets/characters/final-pet/stretch.mov';")
    expect(petAnimations).toContain("import idleVideo from './assets/characters/final-pet/sit.mov';")
    expect(petAnimations).toContain("import lickVideo from './assets/characters/final-pet/cheer.mov';")
  })

  it('keeps the native play overlay disabled while forcing muted inline autoplay', () => {
    expect(videoLayer).toContain('function prepareAutoplayVideo')
    expect(videoLayer).toContain('video.muted = true')
    expect(videoLayer).toContain('video.defaultMuted = true')
    expect(videoLayer).toContain('video.autoplay = true')
    expect(videoLayer).toContain('video.controls = false')
    expect(videoLayer).toContain("video.removeAttribute('controls')")
    expect(videoLayer).toContain("video.setAttribute('muted', '')")
    expect(videoLayer).toContain("video.setAttribute('playsinline', '')")
    expect(videoLayer).toContain("video.setAttribute('autoplay', '')")
    expect(videoLayer).toContain('function playAutoplayVideo')
    expect(videoLayer).toMatch(/playAutoplayVideo\(animation\.id, video\)/)
    expect(videoLayer).toContain('const AUTOPLAY_RETRY_MS = 250')
    expect(videoLayer).toContain('window.setTimeout(attempt, AUTOPLAY_RETRY_MS)')
    expect(videoLayer).toContain('onLoadedData=')
    expect(videoLayer).toContain('onCanPlay=')
    expect(videoLayer).toContain('className={classNameFor(animation)}')
    expect(videoLayer).toContain('controls={false}')
    expect(videoLayer).toContain('disablePictureInPicture')
    expect(videoLayer).not.toContain('canvasRefs')

    expect(styles).toContain('.pet-video::-webkit-media-controls-overlay-play-button')
    expect(styles).toContain('.pet-video::-webkit-media-controls-start-playback-button')
    expect(styles).toContain('display: none !important')
    expect(styles).toContain('opacity: 0 !important')
    expect(styles).toContain('pointer-events: none !important')
  })

  it('keeps the same one-shot idle scheduling shape as demo_v0.1', () => {
    const idleAnimation = constBlock(petAnimations, 'export const IDLE_ANIMATION')

    expect(idleAnimation).toContain('loop: false')
    expect(idleAnimation).not.toContain('loop: true')
    expect(videoLayer).not.toContain("if (animation.id === 'idle') return;")
    expect(mainUi).toContain("if (animationRef.current.id === 'idle')")
    expect(panelUi).toContain("if (animationRef.current.id === 'idle')")
  })
})

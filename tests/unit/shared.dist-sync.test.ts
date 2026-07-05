import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sharedSrc = readFileSync(join(ROOT, 'packages/shared/src/config.ts'), 'utf8')
const sharedDist = readFileSync(join(ROOT, 'packages/shared/dist/config.js'), 'utf8')
const sharedTypes = readFileSync(join(ROOT, 'packages/shared/dist/config.d.ts'), 'utf8')

describe('shared config compiled output', () => {
  it('keeps runtime dist config in sync with settings-page fields', () => {
    expect(sharedSrc).toContain('behaviorFrequency')
    expect(sharedSrc).toContain('llmDebug')

    expect(sharedDist).toContain('pet:')
    expect(sharedDist).toContain("behaviorFrequency: 'normal'")
    expect(sharedDist).toContain('llmDebug:')
    expect(sharedDist).toContain("baseUrl: 'https://api.deepseek.com/v1'")
    expect(sharedDist).toContain("model: 'deepseek-v4-flash'")

    expect(sharedTypes).toContain('PetBehaviorFrequency')
    expect(sharedTypes).toContain('behaviorFrequency: PetBehaviorFrequency')
    expect(sharedTypes).toContain('llmDebug')
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRandomTailHoldMs } from '../../apps/shell/ui/petAnimationScheduler'
import { assembleSystem } from '../../packages/harness/src/persona/assemble'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const mainUi = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')
const panelUi = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')

describe('settings runtime integration', () => {
  it('maps behavior frequency to real animation hold intervals', () => {
    // continuous = 零间隔：动作播完立即回坐姿、坐姿播完立即接下一动作（连续轮播档）
    expect(getRandomTailHoldMs('continuous', () => 0)).toBe(0)
    expect(getRandomTailHoldMs('continuous', () => 1)).toBe(0)
    expect(getRandomTailHoldMs('active', () => 0)).toBe(30_000)
    expect(getRandomTailHoldMs('active', () => 1)).toBe(45_000)
    expect(getRandomTailHoldMs('normal', () => 0)).toBe(120_000)
    expect(getRandomTailHoldMs('normal', () => 1)).toBe(150_000)
    expect(getRandomTailHoldMs('quiet', () => 0)).toBe(300_000)
    expect(getRandomTailHoldMs('quiet', () => 1)).toBe(360_000)
  })

  it('uses the latest behavior frequency in the pet window and home pet preview', () => {
    expect(mainUi).toContain('const [behaviorFrequency, setBehaviorFrequency]')
    expect(mainUi).toContain('IPC.CONFIG_GET')
    expect(mainUi).toContain('IPC.CONFIG_UPDATED')
    // timer 回调经 ref 取最新档位，且频率变化时立即重排等待中的切换（否则旧档 timer 最长 6 分钟才生效）
    expect(mainUi).toContain('getRandomTailHoldMs(behaviorFrequencyRef.current)')
    expect(mainUi).toContain('if (tailHoldTimerRef.current !== null) handleAnimationEnded()')

    expect(panelUi).toContain('function useBehaviorFrequency()')
    expect(panelUi).toContain('IPC.CONFIG_UPDATED')
    expect(panelUi).toContain('getRandomTailHoldMs(behaviorFrequencyRef.current)')
    expect(panelUi).toContain('if (tailHoldTimerRef.current !== null) handleAnimationEnded()')
  })

  it('appends the user persona prompt after the app persona core', () => {
    const system = assembleSystem({
      personaCore: '<persona-core>app core</persona-core>',
      userPersona: '喜欢把自己描述成一只认真又有点嘴笨的小猫。',
      companionRules: '<companion-rules>rules</companion-rules>',
      skillIndex: '',
      memoryIndex: '',
      emotionState: '<emotion-state>calm</emotion-state>',
      timeScene: '<time-scene>morning</time-scene>',
    }).system

    expect(system.indexOf('<persona-core>app core</persona-core>')).toBeLessThan(system.indexOf('<user-persona>'))
    expect(system).toContain('喜欢把自己描述成一只认真又有点嘴笨的小猫。')
    expect(system.indexOf('</user-persona>')).toBeLessThan(system.indexOf('<companion-rules>rules</companion-rules>'))
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const panel = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')
const ipc = readFileSync(join(ROOT, 'apps/shell/ui/lib/ipc.ts'), 'utf8')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')
const shellLib = readFileSync(join(ROOT, 'apps/shell/src-tauri/src/lib.rs'), 'utf8')

function functionBody(name: string): string {
  const marker = `function ${name}`
  const start = panel.indexOf(marker)
  if (start === -1) return ''
  const bodyStart = panel.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < panel.length; index += 1) {
    const char = panel[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return panel.slice(bodyStart, index + 1)
  }
  return ''
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))?.[1] ?? ''
}

describe('settings page spec', () => {
  it('renders a real SettingsPage instead of the placeholder route', () => {
    expect(panel).toContain('function SettingsPage()')
    expect(panel).toContain("activeTab === 'settings'")
    expect(panel).toContain('<SettingsPage />')
    expect(panel.indexOf('<SettingsPage />')).toBeLessThan(panel.indexOf('PlaceholderPage title={getTabTitle(activeTab)}'))
  })

  it('includes all settings sections and user-facing frequency explanations', () => {
    const body = functionBody('SettingsPage')

    expect(body).toContain('基础设置')
    expect(body).toContain('开关桌宠')
    expect(body).toContain('行为设置')
    // 档位说明收敛到模块级 BEHAVIOR_OPTIONS/PROACTIVE_OPTIONS 常量的 hint 字段（在下拉菜单选项内展示）
    expect(panel).toContain('约 5 分钟换一次动作')
    expect(panel).toContain('约 2 分钟换一次动作')
    expect(panel).toContain('约 30 秒换一次动作')
    expect(panel).toContain('动作不间断轮播')
    expect(panel).toContain("value: 'continuous'")
    expect(body).toContain('主动说话')
    expect(panel).toContain('约 15 分钟一次')
    expect(panel).toContain('约 45 分钟一次')
    expect(panel).toContain('约 2 小时一次')
    expect(panel).toContain('不主动闲聊')
    expect(body).toContain('options={BEHAVIOR_OPTIONS}')
    expect(body).toContain('options={PROACTIVE_OPTIONS}')
    expect(body).toContain('自定义宠物描述')
    expect(body).toContain('最多 500 字')
    expect(body).toContain('调试设置')
    expect(body).toContain('Base URL')
    expect(body).toContain('API Key')
    expect(body).toContain('Model')
    expect(body).toContain('连接测试')
    expect(body).toContain('恢复默认设置')
  })

  it('uses the shared custom dropdown for behavior controls with in-menu explanations', () => {
    const body = functionBody('SettingsPage')

    expect(panel).toContain('function SettingsSelect')
    expect(panel).toContain("import { Dropdown } from './Dropdown'")
    expect(body).toContain('label="行为变化"')
    expect(body).toContain('label="主动说话"')
    expect(body).not.toContain('label="行为变化频次"')
    expect(body).not.toContain('label="主动说话频次"')
    // 原生 select 全部退役：面板内不再出现系统默认下拉
    expect(panel).not.toContain('<select')
    expect(panel).not.toContain('settings-select-hint')
    expect(panel).not.toContain('function SettingsSlider')
    expect(panel).not.toContain('type="range"')
    expect(panel).not.toContain('function SettingsSegmented')
  })

  it('omits verbose helper copy from the visible settings page', () => {
    const body = functionBody('SettingsPage')

    expect(body).not.toContain('这些入口和右键菜单、菜单栏保持一致。')
    expect(body).not.toContain('等同于右键菜单“隐藏宠物”和菜单栏“桌宠开关”，重启后默认显示。')
    expect(body).not.toContain('只影响无操作时的自动动作，不影响点击和拖拽。')
    expect(body).not.toContain('低于应用内置 system prompt 的用户人设补充，影响回复和主动闲聊。')
  })

  it('uses real IPC and shell commands for persisted settings and pet visibility', () => {
    const body = functionBody('SettingsPage')

    expect(panel).toContain("import { isTauri, on, request } from './lib/ipc'")
    expect(panel).toContain("import { invoke } from '@tauri-apps/api/core'")
    expect(body).toContain('IPC.CONFIG_GET')
    expect(body).toContain('IPC.CONFIG_SET')
    expect(body).toContain('IPC.PERSONA_GET')
    expect(body).toContain('IPC.PERSONA_SET')
    expect(body).toContain('IPC.LLM_KEY_GET')
    expect(body).toContain('IPC.LLM_KEY_SET')
    expect(body).toContain('IPC.LLM_KEY_CLEAR')
    expect(body).toContain('IPC.LLM_DEBUG_TEST')
    expect(body).toContain("invoke('pet_visibility_get')")
    expect(body).toContain("invoke('pet_visibility_set'")
    expect(body).not.toContain("invoke('llm_debug_test'")
  })

  it('adds dedicated Tauri commands for settings page pet visibility and LLM testing', () => {
    expect(shellLib).toContain('fn pet_visibility_get(app: AppHandle) -> bool')
    expect(shellLib).toContain('fn pet_visibility_set(app: AppHandle, visible: bool)')
    expect(shellLib).toContain('fn llm_debug_test(base_url: String, api_key: Option<String>, model: String)')
    expect(shellLib).toContain('pet_visibility_get')
    expect(shellLib).toContain('pet_visibility_set')
    expect(shellLib).toContain('llm_debug_test')
  })

  it('has compact grouped settings styles inside the panel surface', () => {
    expect(rule('.settings-page')).toContain('overflow: hidden;')
    expect(rule('.settings-content')).toContain('overflow-y: auto;')
    expect(rule('.settings-section')).toContain('border: 1px solid')
    expect(rule('.settings-row')).toContain('grid-template-columns:')
    expect(rule('.settings-select-row')).toContain('grid-template-columns:')
    expect(rule('.ui-dropdown-menu')).toContain('position: absolute;')
    expect(rule('.ui-dropdown-option small')).toContain('font-size:')
    expect(rule('.settings-content')).toContain('padding:')
    expect(rule('.settings-toast')).toContain('position: absolute;')
  })

  it('keeps browser mock settings stateful enough for local preview', () => {
    expect(ipc).toContain('let mockConfig')
    expect(ipc).toContain('let mockPersona')
    expect(ipc).toContain('let mockLlmKeyTail')
    expect(ipc).toContain('case IPC.CONFIG_SET:')
    expect(ipc).toContain('case IPC.PERSONA_GET:')
    expect(ipc).toContain('case IPC.PERSONA_SET:')
    expect(ipc).toContain('case IPC.LLM_KEY_GET:')
    expect(ipc).toContain('case IPC.LLM_KEY_SET:')
    expect(ipc).toContain('case IPC.LLM_KEY_CLEAR:')
    expect(ipc).toContain('case IPC.LLM_DEBUG_TEST:')
  })
})

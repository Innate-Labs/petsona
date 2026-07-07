import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const shellLib = readFileSync(join(ROOT, 'apps/shell/src-tauri/src/lib.rs'), 'utf8')

function getSetupBody(): string {
  const match = shellLib.match(/\.setup\(\|app\| \{([\s\S]*?)\n\s*Ok\(\(\)\)/m)
  return match?.[1] ?? ''
}

function getFunctionBody(name: string): string {
  const match = shellLib.match(new RegExp(`fn ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`, 'm'))
  return match?.[1] ?? ''
}

describe('shell window lifecycle', () => {
  it('does not open the main panel during app setup', () => {
    expect(getSetupBody()).not.toContain('open_panel(app.handle().clone(), None);')
  })

  it('closing the float chat only hides the float window', () => {
    const closeFloatBody = getFunctionBody('close_float_chat')

    expect(closeFloatBody).toContain('get_webview_window("float")')
    expect(closeFloatBody).toContain('win.hide()')
    expect(closeFloatBody).not.toContain('open_panel')
    expect(closeFloatBody).not.toContain('show_panel')
  })

  it('opens the float chat unpinned so the UI pin button controls always-on-top', () => {
    const openFloatBody = getFunctionBody('open_float_chat')

    expect(openFloatBody).toContain('.always_on_top(false)')
    expect(openFloatBody).not.toContain('.always_on_top(true)')
  })
})

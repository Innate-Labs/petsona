import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const shellLib = readFileSync(join(ROOT, 'apps/shell/src-tauri/src/lib.rs'), 'utf8')
const petBridge = readFileSync(join(ROOT, 'apps/shell/ui/petAgentBridge.ts'), 'utf8')
const mainUi = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')
const petWindowUi = readFileSync(join(ROOT, 'apps/shell/ui/pet/PetWindow.tsx'), 'utf8')
const tray = readFileSync(join(ROOT, 'apps/shell/src-tauri/src/tray.rs'), 'utf8')

function rustFunctionBody(name: string): string {
  const marker = `fn ${name}`
  const start = shellLib.indexOf(marker)
  if (start === -1) return ''

  const bodyStart = shellLib.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < shellLib.length; index += 1) {
    const char = shellLib[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return shellLib.slice(bodyStart, index + 1)
  }
  return ''
}

describe('pet window behavior', () => {
  it('renders the desktop pet window through PetVideoLayer instead of Sprite', () => {
    expect(petWindowUi).toContain("import { PetVideoLayer } from '../PetVideoLayer'")
    expect(petWindowUi).toContain('<PetVideoLayer activeAnimation={animation} onEnded={handleAnimationEnded} />')
    expect(petWindowUi).not.toContain("import { Sprite } from './Sprite'")
    expect(petWindowUi).not.toContain('<Sprite emotion={emotion} action={action} />')
  })

  it('drives pet window actions with PetAnimation state from petAnimations', () => {
    expect(petWindowUi).toContain(
      "import { DRAG_ANIMATION, IDLE_ANIMATION, PET_ACTION_SEQUENCE, type PetAnimation } from '../petAnimations'"
    )
    expect(petWindowUi).toContain('const [animation, setAnimation] = useState<PetAnimation>(IDLE_ANIMATION)')
    expect(petWindowUi).toContain('switchAnimation(DRAG_ANIMATION)')
    expect(petWindowUi).toContain('switchAnimation(IDLE_ANIMATION)')
    expect(petWindowUi).not.toContain('const [action, setAction] = useState<PoseName | null>(null)')
  })

  it('resizes the pet window through a dedicated shell command', () => {
    expect(shellLib).toContain('const MIN_PET_SIZE: f64 = 180.0;')
    expect(shellLib).toContain('const MAX_PET_SIZE: f64 = 420.0;')
    expect(shellLib).toContain('fn resize_pet_window(app: AppHandle, size: f64)')
    expect(shellLib).toContain('resize_pet_window')

    expect(petBridge).toContain("invoke('resize_pet_window', { size })")
    expect(petBridge).not.toContain('getCurrentWindow().setSize(new LogicalSize(size, size))')
  })

  it('opens a pet context menu from the pet view', () => {
    expect(shellLib).toContain('fn show_pet_menu(app: AppHandle, window: tauri::WebviewWindow)')
    expect(shellLib).toContain('window.popup_menu(&menu)')
    expect(shellLib).toContain('show_pet_menu')
    expect(mainUi).toContain("invoke('show_pet_menu')")
    expect(mainUi).toContain('onPointerDownCapture={openPetMenuOnRightPointer}')
    expect(mainUi).toContain('onContextMenu={openPetContextMenu}')
    expect(petWindowUi).toContain("invoke('show_pet_menu')")
    expect(petWindowUi).toContain('onPointerDownCapture={openPetMenuOnRightPointer}')
    expect(petWindowUi).toContain('onContextMenu={openPetContextMenu}')
    expect(mainUi).toContain('event.button !== 2')
    expect(petWindowUi).toContain('e.button !== 2')
  })

  it('routes pet context-menu items using the demo menu shape', () => {
    const menuBody = rustFunctionBody('show_pet_menu')
    const routeBody = rustFunctionBody('handle_pet_menu_event')

    expect(menuBody).toContain('"首页"')
    expect(menuBody).toContain('"宠物数据"')
    expect(menuBody).toContain('"对话记录"')
    expect(menuBody).toContain('"提醒事项"')
    expect(menuBody).toContain('"设置中心"')
    expect(menuBody).toContain('"隐藏桌宠"')
    expect(menuBody).toContain('"退出"')
    expect(menuBody).toMatch(
      /Menu::with_items\(&app, &\[\s*&home,\s*&pet_data,\s*&chat,\s*&reminders,\s*&settings,\s*&separator_one,\s*&hide,\s*&quit,\s*\]\)/
    )

    expect(routeBody).toContain('"pet_menu_chat" => show_panel(app, "chat")')
    expect(routeBody).toContain('"pet_menu_home" => show_panel(app, "panel")')
    expect(routeBody).toContain('"pet_menu_pet_data" => show_panel(app, "data")')
    expect(routeBody).toContain('"pet_menu_reminders" => show_panel(app, "reminders")')
    expect(routeBody).toContain('"pet_menu_settings" => show_panel(app, "settings")')
    expect(routeBody).toContain('"pet_menu_hide" => crate::pet_window::hide(app)')
    expect(routeBody).toContain('"pet_menu_quit" => app.exit(0)')
  })

  it('uses demo-style tray menu fields', () => {
    expect(tray).toContain('"tray_home", "首页"')
    expect(tray).toContain('"tray_pet_data", "宠物数据"')
    expect(tray).toContain('"tray_history", "对话记录"')
    expect(tray).toContain('"tray_reminders", "提醒事项"')
    expect(tray).toContain('"tray_settings", "设置中心"')
    expect(tray).toContain('"tray_toggle_pet", "桌宠开关"')
    expect(tray).toContain('"tray_quit", "退出"')

    expect(tray).toContain('"tray_home" => crate::show_panel(app, "panel")')
    expect(tray).toContain('"tray_pet_data" => crate::show_panel(app, "data")')
    expect(tray).toContain('"tray_history" => crate::show_panel(app, "chat")')
    expect(tray).toContain('"tray_reminders" => crate::show_panel(app, "reminders")')
    expect(tray).toContain('"tray_settings" => crate::show_panel(app, "settings")')
    expect(tray).toContain('"tray_toggle_pet" => crate::pet_window::toggle(app)')
    expect(tray).toContain('"tray_quit" => app.exit(0)')
  })
})

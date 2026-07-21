import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const taskLight = readFileSync(join(ROOT, 'apps/shell/ui/pet/TaskLight.tsx'), 'utf8')
const runningNote = readFileSync(join(ROOT, 'apps/shell/ui/TaskRunningNote.tsx'), 'utf8')
const mainUi = readFileSync(join(ROOT, 'apps/shell/ui/main.tsx'), 'utf8')
const floatChat = readFileSync(join(ROOT, 'apps/shell/ui/float/FloatChat.tsx'), 'utf8')
const panel = readFileSync(join(ROOT, 'apps/shell/ui/ManagementPanel.tsx'), 'utf8')
const styles = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')

describe('task status tracking', () => {
  it('subscribes the pet-window task light to harness TASK_EVENT with three phases', () => {
    expect(taskLight).toContain('IPC.TASK_EVENT')
    expect(taskLight).toContain("event.t === 'created'")
    expect(taskLight).toContain("event.t === 'progress'")
    expect(taskLight).toContain("event.t === 'awaiting_approval'")
    expect(taskLight).toContain("event.t === 'result'")
    // 红绿黄三态：running=执行中 / done=成功 / failed=失败（含取消/拒绝/超时文案区分）
    expect(taskLight).toContain("'running' | 'done' | 'failed'")
    expect(taskLight).toContain('任务完成')
    expect(taskLight).toContain('任务失败')
    expect(taskLight).toContain('任务超时')
    expect(taskLight).toContain('等待你的确认')
  })

  it('mounts the task light on the pet stage with chat bubble taking priority', () => {
    expect(mainUi).toContain("import { TaskLight, useTaskLight } from './pet/TaskLight'")
    expect(mainUi).toContain('const taskLight = useTaskLight()')
    expect(mainUi).toContain(') : taskLight ? (')
    expect(mainUi).toContain('<TaskLight state={taskLight} />')
  })

  it('shows a unified task-running wave in both chat surfaces instead of tool details', () => {
    expect(runningNote).toContain('任务执行中')
    expect(runningNote).toContain('task-running-wave')
    expect(floatChat).toContain('<TaskRunningNote className="float-tooling" />')
    expect(panel).toContain('<TaskRunningNote className="panel-tooling" />')
    // 不再把工具详情文案直接铺进聊天流
    expect(floatChat).not.toContain('>{m.tooling}</div>')
    expect(panel).not.toContain('>{message.tooling}</div>')
  })

  it('keeps status note typography consistent across panel and float chat', () => {
    const statusRule = styles.match(/\.panel-reasoning,\s*\.panel-tooling,\s*\.float-reasoning,\s*\.float-tooling\s*\{([\s\S]*?)\}/m)?.[1] ?? ''
    expect(statusRule).toContain('font-size: 13px;')
    expect(statusRule).toContain('color: #8b6a48;')
  })

  it('styles the light bulb per phase with a breathing running state', () => {
    expect(styles).toContain('.pet-task-light.running .pet-task-light-bulb')
    expect(styles).toContain('.pet-task-light.done .pet-task-light-bulb')
    expect(styles).toContain('.pet-task-light.failed .pet-task-light-bulb')
    expect(styles).toContain('@keyframes task-light-breathe')
    expect(styles).toContain('@keyframes task-wave-bounce')
    expect(styles).toContain('pointer-events: none;')
  })
})

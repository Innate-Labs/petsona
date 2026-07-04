import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const page = readFileSync(join(ROOT, 'apps/shell/ui/Reminders.tsx'), 'utf8')
const css = readFileSync(join(ROOT, 'apps/shell/ui/styles.css'), 'utf8')

describe('Reminders page SPEC structure', () => {
  it('keeps the four fixed reminder cards and exposes stats from the page header', () => {
    expect(page).toContain("title: '番茄钟'")
    expect(page).toContain("title: '喝水提醒'")
    expect(page).toContain("title: '站立提醒'")
    expect(page).toContain('免打扰时段')
    expect(page).toContain('reminder-history-button')
    expect(page).toContain("import iconHistory from './assets/figma/icon-history-18.svg'")
    expect(page).toContain('<h1 className="panel-page-title">提醒事项</h1>')
    expect(page).toContain('<img src={iconHistory} alt="" />')
  })

  it('aligns the reminders title with the shared panel page header rhythm', () => {
    expect(page).toContain('<div className="panel-page-header">')
    expect(page).not.toContain('<div className="reminders-topbar">')
    expect(css).toContain('grid-template-rows: 54px')
  })

  it('keeps stats navigation clickable below the drag strip and returns from detail before leaving stats', () => {
    expect(page).toContain("selectedDate ? setSelectedDate(null) : setMode('today')")
    expect(css).toContain('padding: 14px 18px 18px')
    expect(css).toContain('-webkit-app-region: no-drag')
    expect(page).toContain('className="reminder-history-back"')
    expect(page).toContain("aria-label={selectedDate ? '返回统计列表' : '返回提醒事项'}")
    expect(page).toContain('<svg viewBox="0 0 1024 1024"')
    expect(page).toContain('<path d="M224.32 505.6a31.936 31.936 0 0 1 10.88-19.84')
    expect(page).not.toContain('<button className="chip" onClick={backFromHistory}>返回</button>')
  })

  it('shows countdowns and editable settings for all timed cards', () => {
    expect(page).toContain('countdownLabel')
    expect(page).toContain('DurationDialog')
    expect(page).toContain("remind-card--active")
    expect(page).not.toContain("c.kind === 'pomodoro' && running")
  })

  it('lets quiet hours be enabled, disabled, and edited without long dropdown menus', () => {
    expect(page).toContain('quietEnabled')
    expect(page).toContain('TimeField')
    expect(page).toContain('toggleQuiet')
    expect(page).not.toContain('<select value={start}')
  })

  it('supports once, daily, and weekly repeat choices in the add/edit flow', () => {
    expect(page).toContain("value=\"once\"")
    expect(page).toContain("value=\"daily\"")
    expect(page).toContain("value=\"weekly\"")
    expect(page).toContain('weekday-grid')
    expect(page).toContain('MiniDatePicker')
  })

  it('uses the empty state copy and styled select controls requested for reminders', () => {
    expect(page).toContain('目前没有待提醒任务，创建一条让宠物提醒你吧～')
    expect(css).toContain('.reminder-control')
    expect(css).toContain('.reminder-select')
  })

  it('keeps reminder dialog inputs and date trigger at one compact height', () => {
    expect(css).toContain('.reminder-date-field .pet-date-trigger')
    expect(css).toContain('.reminder-form .reminder-control')
    expect(css).toContain('height: 38px')
    expect(css).toContain('font-size: 14px')
    expect(css).toContain('line-height: 38px')
    expect(css).toContain('border-radius: 12px')
  })

  it('renders history rows and single-day detail states', () => {
    expect(page).toContain('historyRows')
    expect(page).toContain('selectedDate')
    expect(page).toContain('完成率')
    expect(page).toContain('提醒时间')
    expect(page).toContain('完成时间')
  })

  it('uses compact warm controls that fit the narrow panel', () => {
    expect(css).toContain('.reminders-page')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).toContain('.reminder-history-button')
    expect(css).toContain('.reminder-history-back')
    expect(css).toContain('transition: background .12s ease, color .12s ease;')
    expect(css).toContain('.reminder-history-back svg')
    expect(css).toContain('pointer-events: none;')
    expect(css).toContain('.reminder-form')
    expect(css).toContain('.weekday-grid')
  })

  it('uses the existing deep brown text color across reminder page content', () => {
    expect(css).toContain('--reminder-ink: #402407')
    expect(css).toContain('color: var(--reminder-ink)')
  })

  it('filters deleted template snapshots out of the today reminder rows', () => {
    expect(page).toContain('const todayItems = useMemo(() => sortTodayInstances(')
    expect(page).toContain("if (item.templateId) return state.templates.some((t) => t.id === item.templateId && t.active && !t.deletedAt)")
    expect(page).toContain("return item.source !== 'template'")
  })
})

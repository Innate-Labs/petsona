// Reminders.tsx —— 当前主面板提醒事项页：四卡控制台 + 待提醒 + 日期统计

import { useEffect, useMemo, useRef, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { Config, ConfigGetRes, ReminderFiredPayload, ReminderSetPayload } from '@petsona/shared'
import { on, request } from './lib/ipc'
import { loadPrefs, savePrefs } from './lib/local'
import { Dropdown } from './Dropdown'
import {
  addTemplate,
  completeInstance,
  createTemplate,
  dailyStats,
  deleteTemplate,
  ensureDayInstances,
  loadReminderState,
  reminderHistoryRows,
  saveReminderState,
  sortTodayInstances,
  todayDate,
  updateTemplate,
} from './lib/reminderStore'
import type { ReminderInstance, ReminderRepeat, ReminderState, ReminderTemplate } from './lib/reminderStore'
import { useDialog } from './ModalKit'
import iconDelete from './assets/figma/icon-delete-28.svg'
import iconCheck from './assets/figma/icon-check.svg'

type TimedKind = 'pomodoro' | 'water' | 'stand'
type CardDef = { kind: TimedKind; title: string }
type ReminderSettings = Pick<Config['reminders'], 'pomodoro' | 'waterMin' | 'standMin'>
type FormDraft = {
  id?: string
  title: string
  time: string
  repeatType: ReminderRepeat['type']
  date: string
  weekdays: number[]
}

const CARDS: CardDef[] = [
  { kind: 'pomodoro', title: '番茄钟' },
  { kind: 'water', title: '喝水提醒' },
  { kind: 'stand', title: '站立提醒' },
]

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  pomodoro: { focusMin: 25, restMin: 5 },
  waterMin: 60,
  standMin: 45,
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MINUTE_MS = 60_000

function defaultDraft(): FormDraft {
  const defaultTime = new Date(Date.now() + 3600_000).toTimeString().slice(0, 5)
  const date = todayDate()
  return { title: '', time: defaultTime, repeatType: 'once', date, weekdays: [new Date().getDay()] }
}

function draftFromTemplate(t: ReminderTemplate): FormDraft {
  return {
    id: t.id,
    title: t.title,
    time: t.time,
    repeatType: t.repeat.type,
    date: t.repeat.type === 'once' ? t.repeat.date : todayDate(),
    weekdays: t.repeat.type === 'weekly' ? t.repeat.weekdays : [1],
  }
}

function repeatFromDraft(d: FormDraft): ReminderRepeat {
  if (d.repeatType === 'daily') return { type: 'daily' }
  if (d.repeatType === 'weekly') return { type: 'weekly', weekdays: d.weekdays.length ? d.weekdays : [1] }
  return { type: 'once', date: d.date }
}

function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input className="reminder-control time-field" type="time" value={value} onChange={(e) => onChange(e.target.value)} />
}

function QuietDialog({ initial, onDone }: { initial: [string, string]; onDone: (v: [string, string] | null) => void }) {
  const [start, setStart] = useState(initial[0])
  const [end, setEnd] = useState(initial[1])
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <p className="modal-title">免打扰时段</p>
        <div className="modal-row time-range-row">
          <TimeField value={start} onChange={setStart} />
          <span>至</span>
          <TimeField value={end} onChange={setEnd} />
        </div>
        <p className="modal-hint">这段时间内不主动打扰你</p>
        <div className="modal-actions">
          <button className="chip" onClick={() => onDone(null)}>取消</button>
          <button className="chip chip--doing" onClick={() => onDone([start, end])}>确定</button>
        </div>
      </div>
    </div>
  )
}

function DurationDialog({ kind, initial, onCancel, onSubmit }: {
  kind: TimedKind
  initial: ReminderSettings
  onCancel: () => void
  onSubmit: (settings: ReminderSettings) => void
}) {
  const [focusMin, setFocusMin] = useState(initial.pomodoro.focusMin)
  const [restMin, setRestMin] = useState(initial.pomodoro.restMin)
  const [intervalMin, setIntervalMin] = useState(kind === 'water' ? initial.waterMin : initial.standMin)
  const title = CARDS.find((c) => c.kind === kind)!.title

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value || min)))
  const submit = () => {
    if (kind === 'pomodoro') {
      onSubmit({ ...initial, pomodoro: { focusMin: clamp(focusMin, 1, 180), restMin: clamp(restMin, 1, 60) } })
      return
    }
    const minutes = clamp(intervalMin, 1, 240)
    onSubmit(kind === 'water' ? { ...initial, waterMin: minutes } : { ...initial, standMin: minutes })
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card duration-form" onMouseDown={(e) => e.stopPropagation()}>
        <p className="modal-title">{title}设置</p>
        {kind === 'pomodoro' ? (
          <>
            <label>专注时长<input className="reminder-control" type="number" min={1} max={180} value={focusMin} onChange={(e) => setFocusMin(Number(e.target.value))} /></label>
            <label>休息时长<input className="reminder-control" type="number" min={1} max={60} value={restMin} onChange={(e) => setRestMin(Number(e.target.value))} /></label>
          </>
        ) : (
          <label>提醒间隔<input className="reminder-control" type="number" min={1} max={240} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} /></label>
        )}
        <div className="modal-actions">
          <button type="button" className="chip" onClick={onCancel}>取消</button>
          <button type="button" className="chip chip--doing" onClick={submit}>保存</button>
        </div>
      </div>
    </div>
  )
}

function MiniDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<'down' | 'up'>('down')
  const [selectedDate, setSelectedDate] = useState(value)
  const [viewDate, setViewDate] = useState(() => dateFromKey(value))
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const days = useMemo(() => getCalendarDays(viewDate), [viewDate])

  useEffect(() => {
    setSelectedDate(value)
    setViewDate(dateFromKey(value))
  }, [value])

  const openCalendar = () => {
    const bounds = fieldRef.current?.getBoundingClientRect()
    if (bounds) {
      const popoverHeight = 332
      const bottomSpace = window.innerHeight - bounds.bottom
      const topSpace = bounds.top
      setDirection(bottomSpace < popoverHeight && topSpace > bottomSpace ? 'up' : 'down')
    }
    setOpen((current) => !current)
  }

  const confirm = () => {
    setOpen(false)
    onChange(selectedDate)
  }

  return (
    <div className="pet-date-field reminder-date-field" ref={fieldRef}>
      <button className="pet-date-trigger reminder-control" type="button" onClick={openCalendar}>
        {formatDateKeyLabel(value)}
      </button>
      {open ? (
        <div className={direction === 'up' ? 'pet-date-popover open-upward' : 'pet-date-popover'}>
          <div className="pet-date-monthbar">
            <button type="button" onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))} aria-label="上个月">‹</button>
            <strong>{viewDate.getFullYear()}年{viewDate.getMonth() + 1}月</strong>
            <button type="button" onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))} aria-label="下个月">›</button>
          </div>
          <div className="pet-date-weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="pet-date-grid">
            {days.map((day) => (
              <button key={day.dateKey} type="button" className={day.dateKey === selectedDate ? 'selected' : ''} disabled={!day.inMonth} onClick={() => setSelectedDate(day.dateKey)}>
                {day.label}
              </button>
            ))}
          </div>
          <div className="pet-date-actions">
            <button type="button" onClick={() => setOpen(false)}>取消</button>
            <button type="button" onClick={confirm}>确认</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReminderForm({ initial, onCancel, onSubmit }: { initial: FormDraft; onCancel: () => void; onSubmit: (draft: FormDraft) => void }) {
  const [draft, setDraft] = useState(initial)
  const toggleWeekday = (day: number) => {
    const next = draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort()
    setDraft({ ...draft, weekdays: next })
  }
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal-card reminder-form" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => {
        e.preventDefault()
        if (draft.title.trim()) onSubmit({ ...draft, title: draft.title.trim() })
      }}>
        <p className="modal-title">{draft.id ? '编辑待提醒' : '新增待提醒'}</p>
        <label>内容<input className="reminder-control" value={draft.title} placeholder="例如：下班之后拿快递" onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>提醒时间<TimeField value={draft.time} onChange={(time) => setDraft({ ...draft, time })} /></label>
        <label>重复规则</label>
        <Dropdown
          value={draft.repeatType}
          options={[
            { value: 'once', label: '一次性' },
            { value: 'daily', label: '每天' },
            { value: 'weekly', label: '每周' },
          ]}
          onChange={(repeatType) => setDraft({ ...draft, repeatType, date: draft.date || todayDate() })}
          ariaLabel="重复规则"
          className="reminder"
        />
        {draft.repeatType === 'once' && <MiniDatePicker value={draft.date} onChange={(date) => setDraft({ ...draft, date })} />}
        {draft.repeatType === 'weekly' && (
          <div className="weekday-grid">
            {WEEKDAYS.map((label, day) => (
              <button key={label} type="button" className={draft.weekdays.includes(day) ? 'active' : ''} onClick={() => toggleWeekday(day)}>{label}</button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="chip" onClick={onCancel}>取消</button>
          <button className="chip chip--doing" type="submit">保存</button>
        </div>
      </form>
    </div>
  )
}

export function Reminders() {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [quiet, setQuiet] = useState<[string, string] | null>(null)
  const [quietEditing, setQuietEditing] = useState(false)
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [durationEditing, setDurationEditing] = useState<TimedKind | null>(null)
  const [note, setNote] = useState('')
  const [clockNow, setClockNow] = useState(Date.now())
  const [startedAt, setStartedAt] = useState<Record<string, number>>(() => {
    const now = Date.now()
    return Object.fromEntries(Object.entries(loadPrefs().reminders).filter(([, enabled]) => enabled).map(([kind]) => [kind, now]))
  })
  const [mode, setMode] = useState<'today' | 'history'>('today')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [formDraft, setFormDraft] = useState<FormDraft | null>(null)
  const [state, setState] = useState<ReminderState>(() => ensureDayInstances(loadReminderState(), todayDate()))
  const dialog = useDialog()

  const persist = (next: ReminderState) => { setState(next); saveReminderState(next) }
  const today = todayDate()
  const todayItems = useMemo(() => sortTodayInstances(state.instances.filter((item) => {
    if (item.date !== today) return false
    if (item.templateId) return state.templates.some((t) => t.id === item.templateId && t.active && !t.deletedAt)
    return item.source !== 'template'
  })), [state, today])
  const historyRows = useMemo(() => reminderHistoryRows(state, 30), [state])
  const selectedItems = state.instances.filter((i) => i.date === selectedDate)
  const reminderSettings = settings ?? DEFAULT_REMINDER_SETTINGS
  const quietEnabled = prefs.reminders.quiet !== false

  useEffect(() => {
    saveReminderState(state)
    void request<ConfigGetRes>(IPC.CONFIG_GET, {}).then(({ config }) => {
      setQuiet(config.proactive.quietHours)
      setSettings(config.reminders)
    }).catch(() => {})
    return on<ReminderFiredPayload>(IPC.REMINDER_FIRED, (p) => setNote(p.petLine))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const toggle = (kind: TimedKind) => {
    const running = !!prefs.reminders[kind]
    const next = { ...prefs, reminders: { ...prefs.reminders, [kind]: !running } }
    setPrefs(next); savePrefs(next)
    setStartedAt((current) => {
      const nextStarted = { ...current }
      if (running) delete nextStarted[kind]
      else nextStarted[kind] = Date.now()
      return nextStarted
    })
    void request(running ? IPC.REMINDER_STOP : IPC.REMINDER_SET, { kind } satisfies ReminderSetPayload).catch(() => {})
  }

  const toggleQuiet = () => {
    const next = { ...prefs, reminders: { ...prefs.reminders, quiet: !quietEnabled } }
    setPrefs(next)
    savePrefs(next)
  }

  const saveDuration = (kind: TimedKind, nextSettings: ReminderSettings) => {
    setSettings(nextSettings)
    setDurationEditing(null)
    if (prefs.reminders[kind]) setStartedAt((current) => ({ ...current, [kind]: Date.now() }))
    void request<ConfigGetRes>(IPC.CONFIG_GET, {}).then(({ config }) =>
      request(IPC.CONFIG_SET, { patch: { reminders: { ...config.reminders, ...nextSettings } } satisfies Partial<Config> }),
    ).catch(() => {})
  }

  const applyQuietHours = (next: [string, string] | null) => {
    setQuietEditing(false)
    if (!next) return
    setQuiet(next)
    void request<ConfigGetRes>(IPC.CONFIG_GET, {}).then(({ config }) =>
      request(IPC.CONFIG_SET, { patch: { proactive: { ...config.proactive, quietHours: next } } satisfies Partial<Config> }),
    ).catch(() => {})
  }

  const backFromHistory = () => {
    selectedDate ? setSelectedDate(null) : setMode('today')
  }

  const saveDraft = (draft: FormDraft) => {
    const nowIso = new Date().toISOString()
    const next = draft.id
      ? updateTemplate(state, draft.id, { title: draft.title, time: draft.time, repeat: repeatFromDraft(draft) }, nowIso)
      : addTemplate(state, createTemplate({ title: draft.title, time: draft.time, repeat: repeatFromDraft(draft), nowIso }))
    persist(ensureDayInstances(next, today, nowIso))
    setFormDraft(null)
  }

  const complete = (instance: ReminderInstance) => {
    if (instance.status === 'completed') return
    persist(completeInstance(state, instance.id, new Date().toISOString()))
  }

  const editInstance = (instance: ReminderInstance) => {
    if (!instance.templateId) return
    const template = state.templates.find((t) => t.id === instance.templateId && t.active && !t.deletedAt)
    if (template) setFormDraft(draftFromTemplate(template))
  }

  const removeTemplate = (instance: ReminderInstance) => {
    if (!instance.templateId) return
    void dialog.confirm({ title: `删除「${instance.title}」？\n过去统计记录会保留。`, okText: '删除', danger: true })
      .then((ok) => {
        if (!ok) return
        const next = deleteTemplate(state, instance.templateId!, new Date().toISOString())
        persist(ensureDayInstances(next, today))
      })
  }

  if (mode === 'history') {
    return (
      <div className="reminders-page">
        <div className="panel-page-header">
          <button
            className="reminder-history-back"
            type="button"
            onClick={backFromHistory}
            aria-label={selectedDate ? '返回统计列表' : '返回提醒事项'}
            title={selectedDate ? '返回统计列表' : '返回提醒事项'}
          >
            <svg viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
              <path d="M224.32 505.6a31.936 31.936 0 0 1 10.88-19.84l222.08-222.08a32 32 0 0 1 45.12 45.12l-169.28 169.28H768a32 32 0 0 1 0 64H333.12l169.28 169.28a32 32 0 1 1-45.12 45.44l-224-224a31.968 31.968 0 0 1-8.96-27.2z" />
            </svg>
          </button>
          <h1 className="panel-page-title">{selectedDate ?? '提醒统计'}</h1>
          <div className="panel-page-spacer" />
        </div>
        {!selectedDate && historyRows.map((row) => (
          <button key={row.date} className="history-row" type="button" onClick={() => setSelectedDate(row.date)}>
            <span>{row.date}</span><small>已提醒 {row.reminded} · 已完成 {row.completed} · 完成率 {Math.round(row.rate * 100)}%</small>
          </button>
        ))}
        {!selectedDate && historyRows.length === 0 && <div className="placeholder">还没有统计记录。</div>}
        {selectedDate && selectedItems.map((item) => (
          <div key={item.id} className="history-detail-row">
            <b>{item.title}</b><span>{item.kind} · {item.repeatLabel}</span><span>提醒时间 {item.time}</span><span>完成时间 {item.completedAt ? item.completedAt.slice(11, 16) : '未完成'}</span>
          </div>
        ))}
        {selectedDate && <div className="history-summary">完成率 {Math.round(dailyStats(state, selectedDate).rate * 100)}%</div>}
      </div>
    )
  }

  return (
    <div className="reminders-page">
      <div className="panel-page-header">
        <div className="panel-page-spacer" />
        <h1 className="panel-page-title">提醒事项</h1>
        <button className="reminder-history-button" type="button" onClick={() => setMode('history')} aria-label="提醒统计" title="提醒统计">
          <svg viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
            <path d="M778.24 61.44a122.88 122.88 0 0 1 122.88 122.88v655.36a122.88 122.88 0 0 1-122.88 122.88H245.76a122.88 122.88 0 0 1-122.88-122.88V184.32a122.88 122.88 0 0 1 122.88-122.88h532.48z m0 61.44H245.76a61.44 61.44 0 0 0-61.3376 57.83552L184.32 184.32v655.36a61.44 61.44 0 0 0 57.83552 61.3376L245.76 901.12h532.48a61.44 61.44 0 0 0 61.3376-57.83552L839.68 839.68V184.32a61.44 61.44 0 0 0-57.83552-61.3376L778.24 122.88zM563.2 532.48a30.72 30.72 0 0 1 0 61.44h-266.24a30.72 30.72 0 0 1 0-61.44h266.24z m163.84-225.28a30.72 30.72 0 0 1 0 61.44h-430.08a30.72 30.72 0 0 1 0-61.44h430.08z" />
          </svg>
        </button>
      </div>
      <div className="remind-grid">
        {CARDS.map((c) => {
          const running = !!prefs.reminders[c.kind]
          return (
            <div key={c.kind} className={`remind-card${running ? ' remind-card--active' : ''}`}>
              <p className="remind-card-title">{c.title}</p>
              <button className="remind-card-value remind-card-value--btn" onClick={() => setDurationEditing(c.kind)}>
                {running ? countdownLabel(c.kind, reminderSettings, startedAt[c.kind], clockNow) : configLabel(c.kind, reminderSettings)}
              </button>
              <div className="remind-card-chips"><span className={`chip ${running ? 'chip--doing' : 'chip--off'}`}>{running ? '进行中' : '已关闭'}</span><button className="chip" onClick={() => toggle(c.kind)}>{running ? '停止' : '开启'}</button></div>
            </div>
          )
        })}
        <div className="remind-card"><p className="remind-card-title">免打扰时段</p><button className="remind-card-value remind-card-value--btn remind-card-value--long" onClick={() => quiet && setQuietEditing(true)}>{quiet ? quiet.join('–') : '—'}</button><div className="remind-card-chips"><span className={`chip ${quietEnabled ? 'chip--on' : 'chip--off'}`}>{quietEnabled ? '已开启' : '已关闭'}</span><button className="chip" onClick={toggleQuiet}>{quietEnabled ? '关闭' : '开启'}</button></div></div>
      </div>
      <div className="section-head">待提醒</div>
      {todayItems.map((item) => (
        <div key={item.id} className={`row reminder-row${item.status === 'completed' ? ' row--done' : ''}`}>
          <button className="todo-check" disabled={item.status === 'completed'} aria-label={item.status === 'completed' ? '已完成' : `完成${item.title}`} onClick={() => complete(item)}>{item.status === 'completed' && <img src={iconCheck} alt="" />}</button>
          <button className="row-title reminder-title-btn" disabled={!item.templateId || !state.templates.some((t) => t.id === item.templateId && t.active && !t.deletedAt)} onClick={() => editInstance(item)}>{item.title}<small>{item.repeatLabel}</small></button>
          <span className="row-time">{item.time}</span>
          <button className="row-del" onClick={() => removeTemplate(item)}><img src={iconDelete} alt="删除" /></button>
        </div>
      ))}
      {todayItems.length === 0 && <div className="placeholder">目前没有待提醒任务，创建一条让宠物提醒你吧～</div>}
      {note && <div className="float-tooling" style={{ padding: '8px' }}>{note}</div>}
      <button className="fab" onClick={() => setFormDraft(defaultDraft())} aria-label="新增待提醒">+</button>
      {quietEditing && quiet && <QuietDialog initial={quiet} onDone={applyQuietHours} />}
      {durationEditing && <DurationDialog kind={durationEditing} initial={reminderSettings} onCancel={() => setDurationEditing(null)} onSubmit={(next) => saveDuration(durationEditing, next)} />}
      {formDraft && <ReminderForm initial={formDraft} onCancel={() => setFormDraft(null)} onSubmit={saveDraft} />}
    </div>
  )
}

function configLabel(kind: TimedKind, settings: ReminderSettings): string {
  if (kind === 'pomodoro') return `${settings.pomodoro.focusMin}/${settings.pomodoro.restMin} 分钟`
  return `${kind === 'water' ? settings.waterMin : settings.standMin} 分钟`
}

function countdownLabel(kind: TimedKind, settings: ReminderSettings, startedAt = Date.now(), now = Date.now()): string {
  const minutes = kind === 'pomodoro' ? settings.pomodoro.focusMin : kind === 'water' ? settings.waterMin : settings.standMin
  const totalMs = Math.max(1, minutes) * MINUTE_MS
  const elapsed = Math.max(0, now - startedAt)
  const remaining = totalMs - (elapsed % totalMs)
  const wholeSeconds = Math.max(0, Math.ceil(remaining / 1000))
  return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`
}

function formatDateKeyLabel(dateKey: string): string {
  const date = dateFromKey(dateKey)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year || 2026, (month || 1) - 1, day || 1)
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getCalendarDays(viewDate: Date) {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
  const start = new Date(firstOfMonth)
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      dateKey: toDateKey(date),
      label: date.getDate(),
      inMonth: date.getMonth() === viewDate.getMonth(),
    }
  })
}

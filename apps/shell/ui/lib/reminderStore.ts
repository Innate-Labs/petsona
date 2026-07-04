export type ReminderRepeat =
  | { type: 'once'; date: string }
  | { type: 'daily' }
  | { type: 'weekly'; weekdays: number[] }

export type ReminderTemplate = {
  id: string
  title: string
  time: string
  repeat: ReminderRepeat
  active: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type ReminderKind = 'todo' | 'pomodoro' | 'water' | 'stand' | 'quiet'
export type ReminderStatus = 'pending' | 'reminded' | 'completed' | 'missed'

export type ReminderInstance = {
  id: string
  source: 'template' | 'builtin'
  kind: ReminderKind
  date: string
  title: string
  time: string
  repeatLabel: string
  status: ReminderStatus
  countInCompletionRate: boolean
  templateId?: string
  remindedAt?: string
  completedAt?: string
  snoozedUntil?: string
}

export type ReminderState = {
  templates: ReminderTemplate[]
  instances: ReminderInstance[]
}

export type ReminderStats = {
  date: string
  reminded: number
  completed: number
  rate: number
}

export type DueReminder = ReminderInstance & { dueAt: string }

const K_REMINDER_STATE = 'petsona.reminderState.v1'
const MINUTE_MS = 60_000

export function createReminderState(templates: ReminderTemplate[] = [], instances: ReminderInstance[] = []): ReminderState {
  return { templates: templates.map((t) => ({ ...t })), instances: instances.map((i) => ({ ...i })) }
}

export function isoDate(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input
  return d.toISOString().slice(0, 10)
}

export function todayDate(now = new Date()): string {
  return formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function localDateFromIso(iso: string, offsetMinutes?: number): string {
  const base = new Date(iso)
  if (offsetMinutes === undefined) return todayDate(base)
  const shifted = new Date(base.getTime() + offsetMinutes * MINUTE_MS)
  return formatDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

export function makeId(prefix = 'rem'): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj?.randomUUID) return `${prefix}-${cryptoObj.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function repeatLabel(repeat: ReminderRepeat): string {
  if (repeat.type === 'once') return '一次性'
  if (repeat.type === 'daily') return '每日'
  return `每周${repeat.weekdays.map(weekdayLabel).join('、')}`
}

export function weekdayLabel(day: number): string {
  return ['日', '一', '二', '三', '四', '五', '六'][day] ?? `${day}`
}

export function ensureDayInstances(state: ReminderState, date: string, nowIso = new Date().toISOString()): ReminderState {
  const instances = [...state.instances]
  for (const template of state.templates) {
    if (!shouldInstantiate(template, date)) continue
    const exists = instances.some((i) => i.templateId === template.id && i.date === date)
    if (exists) continue
    instances.push(instanceFromTemplate(template, date, nowIso))
  }
  return { ...state, instances }
}

export function shouldInstantiate(template: ReminderTemplate, date: string): boolean {
  if (!template.active || template.deletedAt) return false
  if (template.repeat.type === 'once') return template.repeat.date === date
  if (template.repeat.type === 'daily') return true
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return template.repeat.weekdays.includes(weekday)
}

export function instanceFromTemplate(template: ReminderTemplate, date: string, _nowIso = new Date().toISOString()): ReminderInstance {
  return {
    id: `inst-${date}-${template.id}`,
    source: 'template',
    kind: 'todo',
    templateId: template.id,
    date,
    title: template.title,
    time: template.time,
    repeatLabel: repeatLabel(template.repeat),
    status: 'pending',
    countInCompletionRate: true,
  }
}

export function createTemplate(input: {
  title: string
  time: string
  repeat: ReminderRepeat
  nowIso?: string
  id?: string
}): ReminderTemplate {
  const nowIso = input.nowIso ?? new Date().toISOString()
  return {
    id: input.id ?? makeId('tpl'),
    title: input.title.trim(),
    time: input.time,
    repeat: input.repeat,
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

export function addTemplate(state: ReminderState, template: ReminderTemplate): ReminderState {
  return { ...state, templates: [...state.templates, { ...template }] }
}

export function updateTemplate(
  state: ReminderState,
  id: string,
  patch: Partial<Pick<ReminderTemplate, 'title' | 'time' | 'repeat' | 'active'>>,
  nowIso = new Date().toISOString(),
): ReminderState {
  return {
    ...state,
    templates: state.templates.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowIso } : t)),
  }
}

export function deleteTemplate(state: ReminderState, id: string, nowIso = new Date().toISOString()): ReminderState {
  const deletedFrom = localDateFromIso(nowIso)
  return {
    ...state,
    templates: state.templates.map((t) => (t.id === id ? { ...t, active: false, deletedAt: nowIso, updatedAt: nowIso } : t)),
    instances: state.instances.filter((i) =>
      i.templateId !== id || i.date < deletedFrom || i.status !== 'pending' || Boolean(i.remindedAt),
    ),
  }
}

export function sortTodayInstances(instances: ReminderInstance[]): ReminderInstance[] {
  return [...instances].sort((a, b) => {
    const aDone = a.status === 'completed' ? 1 : 0
    const bDone = b.status === 'completed' ? 1 : 0
    if (aDone !== bDone) return aDone - bDone
    return minutesFromTime(a.time) - minutesFromTime(b.time)
  })
}

export function markInstanceReminded(state: ReminderState, id: string, remindedAt = new Date().toISOString()): ReminderState {
  return mutateInstance(state, id, (i) => ({ ...i, status: i.status === 'completed' ? i.status : 'reminded', remindedAt }))
}

export function completeInstance(state: ReminderState, id: string, completedAt = new Date().toISOString()): ReminderState {
  return mutateInstance(state, id, (i) => ({
    ...i,
    ...(i.status === 'completed' ? {} : { completedAt }),
    status: 'completed',
    remindedAt: i.remindedAt ?? completedAt,
  }))
}

export function snoozeInstance(state: ReminderState, id: string, nowIso = new Date().toISOString(), minutes = 10): ReminderState {
  const snoozedUntil = new Date(new Date(nowIso).getTime() + minutes * MINUTE_MS).toISOString()
  return mutateInstance(state, id, (i) => ({ ...i, status: 'pending', snoozedUntil }))
}

export function markMissedForDate(state: ReminderState, date: string, nowIso = new Date().toISOString(), offsetMinutes?: number): ReminderState {
  return {
    ...state,
    instances: state.instances.map((i) =>
      i.date === date && i.status !== 'completed' && isPastTime(i, nowIso, offsetMinutes) ? { ...i, status: 'missed' } : i,
    ),
  }
}

export function dueInstances(state: ReminderState, nowIso = new Date().toISOString(), offsetMinutes?: number): DueReminder[] {
  const now = new Date(nowIso)
  const date = localDateFromIso(nowIso, offsetMinutes)
  return sortTodayInstances(state.instances.filter((i) => i.date === date))
    .filter((i) => i.status === 'pending')
    .filter((i) => dueAt(i, date, offsetMinutes).getTime() <= now.getTime())
    .map((i) => ({ ...i, dueAt: dueAt(i, date, offsetMinutes).toISOString() }))
}

export function dailyStats(state: ReminderState, date: string): ReminderStats {
  const day = state.instances.filter((i) => i.date === date)
  const reminded = day.filter((i) => Boolean(i.remindedAt)).length
  const completed = day.filter((i) => i.status === 'completed').length
  const denominator = day.filter((i) => i.countInCompletionRate && Boolean(i.remindedAt)).length
  return { date, reminded, completed, rate: denominator === 0 ? 0 : completed / denominator }
}

export function reminderHistoryRows(state: ReminderState, limit = 30): ReminderStats[] {
  const dates = Array.from(new Set(state.instances.map((i) => i.date))).sort((a, b) => b.localeCompare(a))
  return dates.slice(0, limit).map((date) => dailyStats(state, date))
}

export function loadReminderState(): ReminderState {
  if (typeof localStorage === 'undefined') return createReminderState()
  try {
    const raw = localStorage.getItem(K_REMINDER_STATE)
    if (!raw) return createReminderState()
    const parsed = JSON.parse(raw) as ReminderState
    return createReminderState(parsed.templates ?? [], parsed.instances ?? [])
  } catch {
    return createReminderState()
  }
}

export function saveReminderState(state: ReminderState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(K_REMINDER_STATE, JSON.stringify(state))
}

function mutateInstance(state: ReminderState, id: string, fn: (instance: ReminderInstance) => ReminderInstance): ReminderState {
  return { ...state, instances: state.instances.map((i) => (i.id === id ? fn(i) : i)) }
}

function minutesFromTime(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1]) * 60 + Number(match[2])
}

function dueAt(instance: ReminderInstance, date: string, offsetMinutes?: number): Date {
  if (instance.snoozedUntil) return new Date(instance.snoozedUntil)
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = instance.time.split(':').map(Number)
  if (offsetMinutes !== undefined) {
    return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, 0, 0) - offsetMinutes * MINUTE_MS)
  }
  return new Date(year!, month! - 1, day!, hour!, minute!, 0, 0)
}

function isPastTime(instance: ReminderInstance, nowIso: string, offsetMinutes?: number): boolean {
  return dueAt(instance, instance.date, offsetMinutes).getTime() < new Date(nowIso).getTime()
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

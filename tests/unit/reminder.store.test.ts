import { describe, expect, it } from 'vitest'
import {
  completeInstance,
  createReminderState,
  dailyStats,
  deleteTemplate,
  dueInstances,
  ensureDayInstances,
  markInstanceReminded,
  localDateFromIso,
  reminderHistoryRows,
  snoozeInstance,
  sortTodayInstances,
  updateTemplate,
} from '../../apps/shell/ui/lib/reminderStore.js'
import type { ReminderTemplate } from '../../apps/shell/ui/lib/reminderStore.js'

const MON = '2026-07-06'
const TUE = '2026-07-07'

function baseTemplates(): ReminderTemplate[] {
  return [
    {
      id: 'daily-trash',
      title: '倒垃圾',
      time: '08:30',
      repeat: { type: 'daily' },
      active: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'weekly-courier',
      title: '拿快递',
      time: '17:55',
      repeat: { type: 'weekly', weekdays: [1] },
      active: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'once-med',
      title: '吃药',
      time: '12:00',
      repeat: { type: 'once', date: MON },
      active: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
  ]
}

describe('reminderStore domain', () => {
  it('uses local calendar days and local reminder times instead of UTC offsets', () => {
    expect(localDateFromIso('2026-07-04T16:30:00.000Z', 480)).toBe('2026-07-05')
    expect(localDateFromIso('2026-07-04T00:30:00.000Z', -420)).toBe('2026-07-03')

    let state = createReminderState([
      {
        id: 'daily-night',
        title: '睡前关灯',
        time: '00:30',
        repeat: { type: 'daily' },
        active: true,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ])
    state = ensureDayInstances(state, '2026-07-05', '2026-07-04T16:01:00.000Z')

    expect(dueInstances(state, '2026-07-04T16:29:00.000Z', 480)).toEqual([])
    expect(dueInstances(state, '2026-07-04T16:30:00.000Z', 480).map((i) => i.templateId)).toEqual(['daily-night'])
  })

  it('generates daily instances from once, daily, and matching weekly templates without duplicates', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    state = ensureDayInstances(state, MON, '2026-07-06T00:02:00.000Z')

    expect(state.instances.map((i) => [i.templateId, i.date, i.title, i.time])).toEqual([
      ['daily-trash', MON, '倒垃圾', '08:30'],
      ['weekly-courier', MON, '拿快递', '17:55'],
      ['once-med', MON, '吃药', '12:00'],
    ])

    state = ensureDayInstances(state, TUE, '2026-07-07T00:01:00.000Z')
    expect(state.instances.filter((i) => i.date === TUE).map((i) => i.templateId)).toEqual(['daily-trash'])
  })

  it('keeps historical instance snapshots when a template is edited or deleted', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    const initialCourier = state.instances.find((i) => i.templateId === 'weekly-courier' && i.date === MON)!
    state = markInstanceReminded(state, initialCourier.id, '2026-07-06T17:55:00.000Z')
    state = updateTemplate(state, 'daily-trash', { title: '倒厨余垃圾', time: '09:00' }, '2026-07-06T10:00:00.000Z')
    state = deleteTemplate(state, 'weekly-courier', '2026-07-06T18:00:00.000Z')

    const mondayTrash = state.instances.find((i) => i.templateId === 'daily-trash' && i.date === MON)!
    const mondayCourier = state.instances.find((i) => i.templateId === 'weekly-courier' && i.date === MON)!
    expect(mondayTrash.title).toBe('倒垃圾')
    expect(mondayTrash.time).toBe('08:30')
    expect(mondayCourier.title).toBe('拿快递')

    state = ensureDayInstances(state, TUE, '2026-07-07T00:01:00.000Z')
    const tuesdayTrash = state.instances.find((i) => i.templateId === 'daily-trash' && i.date === TUE)!
    expect(tuesdayTrash.title).toBe('倒厨余垃圾')
    expect(tuesdayTrash.time).toBe('09:00')
    expect(state.instances.some((i) => i.templateId === 'weekly-courier' && i.date === TUE)).toBe(false)
  })

  it('removes pending current and future instances when deleting a template while preserving reminded history', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    state = ensureDayInstances(state, '2026-07-13', '2026-07-13T00:01:00.000Z')
    const mondayCourier = state.instances.find((i) => i.templateId === 'weekly-courier' && i.date === MON)!
    state = markInstanceReminded(state, mondayCourier.id, '2026-07-06T17:55:00.000Z')
    state = deleteTemplate(state, 'weekly-courier', '2026-07-06T18:00:00.000Z')

    expect(state.instances.some((i) => i.templateId === 'weekly-courier' && i.date === MON)).toBe(true)
    expect(state.instances.some((i) => i.templateId === 'weekly-courier' && i.date === '2026-07-13')).toBe(false)
  })

  it('keeps completion actions idempotent so a second click does not rewrite the original time', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    const med = state.instances.find((i) => i.templateId === 'once-med')!
    state = completeInstance(state, med.id, '2026-07-06T12:03:00.000Z')
    state = completeInstance(state, med.id, '2026-07-06T12:08:00.000Z')

    expect(state.instances.find((i) => i.id === med.id)!.completedAt).toBe('2026-07-06T12:03:00.000Z')
  })

  it('sorts today items by incomplete due time and sinks completed items', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    const med = state.instances.find((i) => i.templateId === 'once-med')!
    state = completeInstance(state, med.id, '2026-07-06T12:03:00.000Z')

    expect(sortTodayInstances(state.instances.filter((i) => i.date === MON)).map((i) => i.templateId)).toEqual([
      'daily-trash',
      'weekly-courier',
      'once-med',
    ])
  })

  it('tracks reminded and completed counts while excluding quiet records from completion rate', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    const [trash, courier, med] = sortTodayInstances(state.instances)
    state = markInstanceReminded(state, trash!.id, '2026-07-06T08:30:00.000Z')
    state = completeInstance(state, trash!.id, '2026-07-06T08:31:00.000Z')
    state = markInstanceReminded(state, courier!.id, '2026-07-06T17:55:00.000Z')
    state = markInstanceReminded(state, med!.id, '2026-07-06T12:00:00.000Z')
    state.instances.push({
      id: 'quiet-2026-07-06',
      source: 'builtin',
      kind: 'quiet',
      date: MON,
      title: '免打扰时段',
      time: '22:00',
      repeatLabel: '每日',
      status: 'reminded',
      remindedAt: '2026-07-06T22:00:00.000Z',
      countInCompletionRate: false,
    })

    expect(dailyStats(state, MON)).toEqual({
      date: MON,
      reminded: 4,
      completed: 1,
      rate: 1 / 3,
    })
    expect(reminderHistoryRows(state, 30)[0]).toEqual({
      date: MON,
      reminded: 4,
      completed: 1,
      rate: 1 / 3,
    })
  })

  it('finds due instances, marks them reminded, and snoozes for exactly ten minutes', () => {
    let state = createReminderState(baseTemplates())
    state = ensureDayInstances(state, MON, '2026-07-06T00:01:00.000Z')
    expect(dueInstances(state, '2026-07-06T08:35:00.000Z', 0).map((i) => i.templateId)).toEqual(['daily-trash'])

    const due = dueInstances(state, '2026-07-06T08:35:00.000Z', 0)[0]!
    state = markInstanceReminded(state, due.id, '2026-07-06T08:35:00.000Z')
    expect(dueInstances(state, '2026-07-06T08:36:00.000Z', 0)).toEqual([])

    state = snoozeInstance(state, due.id, '2026-07-06T08:36:00.000Z', 10)
    expect(dueInstances(state, '2026-07-06T08:45:00.000Z', 0)).toEqual([])
    expect(dueInstances(state, '2026-07-06T08:46:00.000Z', 0).map((i) => i.id)).toEqual([due.id])
  })
})

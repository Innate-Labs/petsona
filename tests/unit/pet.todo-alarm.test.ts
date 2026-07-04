import { describe, expect, it } from 'vitest'
import {
  buildReminderBubble,
  completeFromBubbleAction,
  snoozeFromBubbleAction,
} from '../../apps/shell/ui/pet/reminderAlarm.js'
import {
  createReminderState,
  ensureDayInstances,
  markInstanceReminded,
  snoozeInstance,
} from '../../apps/shell/ui/lib/reminderStore.js'
import type { ReminderTemplate } from '../../apps/shell/ui/lib/reminderStore.js'

const template: ReminderTemplate = {
  id: 'tpl-water-plants',
  title: '给猫猫换水',
  time: '08:30',
  repeat: { type: 'daily' },
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

describe('pet reminder alarm bridge', () => {
  it('builds an actionable bubble with complete and snooze actions', () => {
    const state = ensureDayInstances(createReminderState([template]), '2026-07-06', '2026-07-06T00:01:00.000Z')
    const due = state.instances[0]!
    const bubble = buildReminderBubble(due)

    expect(bubble).toEqual({
      kind: 'reminder',
      durationMs: 15_000,
      text: '叮～到点啦，别忘了：给猫猫换水',
      actions: [
        { actionId: `reminder:complete:${due.id}`, label: '完成' },
        { actionId: `reminder:snooze:${due.id}`, label: '稍后提醒' },
      ],
    })
  })

  it('completes or snoozes an instance from bubble action ids', () => {
    let state = ensureDayInstances(createReminderState([template]), '2026-07-06', '2026-07-06T00:01:00.000Z')
    const due = state.instances[0]!
    state = markInstanceReminded(state, due.id, '2026-07-06T08:30:00.000Z')
    expect(completeFromBubbleAction(state, `reminder:complete:${due.id}`, '2026-07-06T08:32:00.000Z').instances[0]!.status).toBe('completed')

    state = markInstanceReminded(state, due.id, '2026-07-06T08:30:00.000Z')
    const snoozed = snoozeFromBubbleAction(state, `reminder:snooze:${due.id}`, '2026-07-06T08:32:00.000Z')
    expect(snoozed.instances[0]!.status).toBe('pending')
    expect(snoozed.instances[0]!.snoozedUntil).toBe('2026-07-06T08:42:00.000Z')
    expect(snoozed).toEqual(snoozeInstance(state, due.id, '2026-07-06T08:32:00.000Z', 10))
  })
})

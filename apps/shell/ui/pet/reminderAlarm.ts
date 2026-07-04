import type { PetBubblePayload } from '@petsona/shared'
import {
  completeInstance,
  snoozeInstance,
} from '../lib/reminderStore'
import type { ReminderInstance, ReminderState } from '../lib/reminderStore'

const COMPLETE_PREFIX = 'reminder:complete:'
const SNOOZE_PREFIX = 'reminder:snooze:'

export function buildReminderBubble(instance: ReminderInstance): PetBubblePayload {
  return {
    kind: 'reminder',
    durationMs: 15_000,
    text: `叮～到点啦，别忘了：${instance.title}`,
    actions: [
      { actionId: `${COMPLETE_PREFIX}${instance.id}`, label: '完成' },
      { actionId: `${SNOOZE_PREFIX}${instance.id}`, label: '稍后提醒' },
    ],
  }
}

export function completeFromBubbleAction(state: ReminderState, actionId: string, nowIso = new Date().toISOString()): ReminderState {
  if (!actionId.startsWith(COMPLETE_PREFIX)) return state
  return completeInstance(state, actionId.slice(COMPLETE_PREFIX.length), nowIso)
}

export function snoozeFromBubbleAction(state: ReminderState, actionId: string, nowIso = new Date().toISOString()): ReminderState {
  if (!actionId.startsWith(SNOOZE_PREFIX)) return state
  return snoozeInstance(state, actionId.slice(SNOOZE_PREFIX.length), nowIso, 10)
}

export function isReminderBubbleAction(actionId: string): boolean {
  return actionId.startsWith(COMPLETE_PREFIX) || actionId.startsWith(SNOOZE_PREFIX)
}

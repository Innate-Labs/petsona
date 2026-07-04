# Reminders Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Petsona reminders control page from `docs/REMINDERS_PAGE_SPEC.md`, including local reminder templates, daily instances, bubble actions, and history stats.

**Architecture:** Keep the React page thin by moving reminder domain logic into `apps/shell/ui/lib/reminderStore.ts`. The panel page renders four fixed cards, the today list, and history/detail views; the pet window polls the same store and fires actionable bubbles. Existing `REMINDER_SET/STOP`, config IPC, and panel dialog utilities remain in use.

**Tech Stack:** React 18, TypeScript, Tauri IPC bridge, Vitest, localStorage-backed UI store as an MVP bridge with typed domain functions.

---

### Task 1: Reminder Domain Store

**Files:**
- Create: `apps/shell/ui/lib/reminderStore.ts`
- Create: `tests/unit/reminder.store.test.ts`

- [ ] Write failing tests for daily instance generation, sorting, completion stats, snooze, and immutable history snapshots.
- [ ] Run `pnpm vitest run tests/unit/reminder.store.test.ts` and verify it fails because `reminderStore.ts` does not exist.
- [ ] Implement typed reminder templates, instances, stats helpers, and local persistence functions.
- [ ] Run `pnpm vitest run tests/unit/reminder.store.test.ts` and verify it passes.

### Task 2: Reminder Panel UI

**Files:**
- Modify: `apps/shell/ui/Reminders.tsx`
- Modify: `apps/shell/ui/styles.css`
- Create: `tests/unit/reminders.page.spec.test.ts`

- [ ] Write failing structural tests for the four fixed cards, stats entry, repeat controls, and history/detail states.
- [ ] Run `pnpm vitest run tests/unit/reminders.page.spec.test.ts` and verify it fails against the current page.
- [ ] Replace the old localStorage Todo UI with store-backed today list, add/edit dialog, delete confirm, stats list, and day detail view.
- [ ] Add compact warm-card styles that fit the current panel width.
- [ ] Run `pnpm vitest run tests/unit/reminders.page.spec.test.ts tests/unit/reminder.store.test.ts` and verify they pass.

### Task 3: Pet Bubble Completion Loop

**Files:**
- Modify: `apps/shell/ui/pet/Bubble.tsx`
- Modify: `apps/shell/ui/pet/PetWindow.tsx`
- Create: `tests/unit/pet.todo-alarm.test.ts`

- [ ] Write failing tests for due reminders, completion action labels, and 10-minute snooze.
- [ ] Run `pnpm vitest run tests/unit/pet.todo-alarm.test.ts` and verify it fails.
- [ ] Update `PetWindow` to poll reminder instances from the new store and emit action-enabled bubbles.
- [ ] Update `Bubble` to render optional action buttons.
- [ ] Run `pnpm vitest run tests/unit/pet.todo-alarm.test.ts tests/unit/reminder.store.test.ts` and verify they pass.

### Task 4: Integration Verification

**Files:**
- Modify tests as needed only to align with the new SPEC.

- [ ] Run `pnpm test`.
- [ ] If full test run is too slow or blocked, run focused unit tests plus `pnpm vitest run tests/unit/structural.test.ts tests/unit/pet.window.behavior.test.ts tests/unit/management.panel.routing.test.ts`.
- [ ] Start the UI preview if feasible with `pnpm --filter @petsona/shell dev` and inspect the reminders route.

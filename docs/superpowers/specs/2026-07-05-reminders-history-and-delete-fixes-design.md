# Reminders History And Delete Fixes Design

## Goal

Fix three reminders-page regressions in `petsona-main`:

1. completed reminder items can still be deleted cleanly
2. the reminders statistics page can always return to the previous state
3. the stats back button uses an arrow icon and matches the home-page plus button in size and color rhythm

## Problems

### Completed reminder deletion feels broken

In `apps/shell/ui/Reminders.tsx`, deleting a template intentionally preserves historical instance snapshots. That is correct for stats, but the current "今日待提醒" list renders all instances for today, including completed snapshots whose template has already been deleted. The delete action succeeds in data terms, but the row remains visible in today's list, so it looks like deletion failed.

### Stats page back navigation is fragile

The history view uses `selectedDate ? setSelectedDate(null) : setMode('today')`, which is the right state transition, but the back control is currently a plain chip button placed in the page header. Its interaction and visual priority do not match the page shell controls, and the current layout makes the return affordance feel inconsistent and easy to misread as a static label-level button.

### Back button styling is inconsistent

The stats-page back button currently says `返回` and uses the generic `.chip` style. The user wants an arrow button that visually matches the home-page `+` action button: same circular footprint, same color family, same emphasis level.

## Scope

In scope:

- adjust today's reminders list so deleted-template history snapshots no longer appear as active list rows
- keep history and stats data intact
- harden stats-page back behavior in the current local state model
- restyle the stats-page back control to an arrow button matching the home-page action button
- add tests covering the delete visibility rule, history return logic, and button styling contract

Out of scope:

- redesigning the whole reminders page
- changing historical stats calculations
- changing reminder domain persistence semantics beyond what the page needs

## Design

### Today list visibility rule

The "今日待提醒" list should only show:

- instances whose backing template still exists and is active, or
- non-template instances that are intentionally system-owned

Completed snapshots for deleted templates should remain in `state.instances` for statistics, but should be filtered out from the today-page rendering list.

### History navigation

The history page keeps the same two-level state model:

- level 1: list of dates
- level 2: selected single-day detail

Back behavior remains:

- if a single day is open, back returns to the date list
- if no day is selected, back returns to the main reminders page

The implementation stays local to `Reminders.tsx`; no router-level changes are needed.

### Back button visual contract

The history back button becomes a circular icon button with a left arrow glyph. It should align with the existing header action language already used by the home-page `+` button:

- same 32×32 footprint
- same circular outline rhythm
- same ink color family
- same hover affordance level

This should be implemented as a reminders-specific header action style rather than overloading `.chip`.

## Testing

- add a failing reminders-page spec test that asserts the history header uses an arrow-style button rather than a text chip
- add a failing reminders-page spec test that asserts completed rows with deleted templates are filtered from the today list logic
- add a reminder-store or reminders-page unit test only if needed for the data-visibility rule; prefer page-level tests if the bug is in rendering selection rather than domain persistence
- run focused reminders-related tests and a shell build

## Risks

- filtering too aggressively could hide legitimate builtin/system reminders, so the rule should distinguish template-backed historical snapshots from valid non-template items
- styling changes should stay local to reminders history controls and not accidentally affect generic chips elsewhere

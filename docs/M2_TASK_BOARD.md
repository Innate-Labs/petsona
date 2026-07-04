# M2 Task Board, Subagents, Approval, Undo

> **Status (as of 2026-07-03):** M2 shipped and passed real-machine acceptance on
> 2026-07-02; every mechanism below still reflects current code. M3 (scheduler,
> heartbeat, Dream, memory manager) is documented separately in
> [`packages/harness/src/scheduler/README.md`](../packages/harness/src/scheduler/README.md)
> and [`docs/superpowers/plans/2026-07-03-m3-scheduler.md`](superpowers/plans/2026-07-03-m3-scheduler.md).

This document is the human-facing reference for the M2 task board flow. The code
contract still lives in `packages/shared`; this file explains how the pieces fit
together and how to smoke-test them.

## What Exists

- `dispatch_task` creates durable `$DATA/tasks/task_*.json` records.
- `worker` and `explore` each run with concurrency 1; overflow stays queued.
- Task state is broadcast through `TASK_EVENT`.
- Subagents run through `meta.loop=subagent` against the gateway and use a
  separate `subagent` tool registry.
- File mutations from `fs_write`, `fs_move`, `fs_rename`, and `fs_trash` are
  staged first. They do not touch user files until approval is granted.
- `PLAN_GET`, `APPROVAL_DECISION`, and `UNDO_REQUEST` are implemented in the
  harness.
- The shell Approval panel has a minimal task list, plan detail, approve,
  partial approve, reject, and undo flow.

`shell` remains an immediate execution tool. It is protected by scope,
permission, audit hooks, and builtin L3 rules, but arbitrary command staging is
not implemented.

`web_fetch` proxies through the gateway endpoint `POST /v1/proxy/fetch`
(auth required, SSRF guard, 10s timeout, byte cap). The harness still has a
single network exit in `gateway/client.ts`; fetched page text is wrapped in
`<data>` before entering the subagent context.

## State Machine

```text
queued -> running -> completed
                  -> failed
                  -> awaiting_approval -> applying -> completed
                                      -> rejected
queued/running/awaiting_approval -> cancelled
```

`awaiting_approval` is entered by throwing `TaskAwaitingApproval` from the
subagent executor after a staging plan is created. The task keeps its `planId`
and partial result on disk so the panel can recover after restart.

Terminal states are `completed`, `failed`, `rejected`, `cancelled`, and
`timeout`.

## Data Layout

Under `$DATA/<userId>/`:

- `tasks/task_*.json` - durable task records.
- `staging/<taskId>/op_*.txt` - staged write payloads.
- `plans/plan_*.json` - `StagingPlan` records and digest for approval UI.
- `undo/plan_*.json` - undo journal written after apply.
- `outputs/<taskId>/` - large tool output, screenshots, and subagent TODO files.
- `logs/audit.jsonl` - tool audit records.

## IPC

- `TASK_LIST_GET` returns `{ tasks }`.
- `TASK_CANCEL` cancels queued/running/awaiting tasks.
- `PLAN_GET { planId }` returns `{ plan }`.
- `APPROVAL_DECISION { planId, decision, excludedOpIds? }` applies or rejects a
  plan. `decision` is `approve`, `reject`, or `partial`.
- `UNDO_REQUEST { planId }` restores changes from the undo journal.

Events:

- `TASK_EVENT created`
- `TASK_EVENT progress`
- `TASK_EVENT awaiting_approval`
- `TASK_EVENT result`

## Safety Rules

- Companion registry still cannot register heavy tools.
- Heavy tools run only through the subagent registry.
- Tool calls go through permission, scope, audit, persist-large, staging, and
  progress hooks.
- Builtin L3 rules still block dangerous `shell`, credential reads, and
  send-as-user AppleScript.
- L2 tools are denied until a richer approval path exists; file mutations use
  explicit staging instead.
- Harness network calls must stay inside `packages/harness/src/gateway/client.ts`.

## Verification

Fast local checks that do not require Node 22 sqlite bindings:

```bash
pnpm build
pnpm --filter @petsona/shell build
pnpm vitest run tests/unit/staging.store.test.ts tests/unit/subagent.executor.test.ts tests/unit/tasks.board.test.ts tests/unit/structural.test.ts
```

Full unit/e2e tests require a Node version matching the installed
`better-sqlite3` native binding (Node 22 as of 2026-07-02).

Manual smoke (verified on a real machine 2026-07-02; see docs/HANDOFF.md for
the fixes that came out of it):

1. Start the gateway with `pnpm dev:gateway`.
2. Start the shell with `pnpm --filter @petsona/shell tauri:dev`.
3. Dispatch a worker task that writes a file inside an authorized scope.
   With the mock LLM, send this in chat (the `@tool` hook triggers tool_use):
   `@tool dispatch_task {"goal":"@tool fs_write {\"path\":\"<path-in-scope>\",\"content\":\"x\"}","agentType":"worker","scope":{"dirs":["<scope-dir>"],"net":false}}`
4. Confirm the task enters `awaiting_approval` (approval entry:
   设置中心 → 审批与撤销).
5. Open the Approval panel and approve the plan.
6. Confirm the file appears or changes only after approval.
7. Trigger undo and confirm the previous file state is restored.

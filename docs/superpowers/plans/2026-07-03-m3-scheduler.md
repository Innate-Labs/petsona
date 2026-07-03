# M3 调度器（cron tick + p01/p02 心跳 + 全屏静默）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付规格 §3.8 的调度与注入子系统：30s cron tick 读 `scheduled.json` → InjectionItem 入队；番茄钟/喝水/站立提醒准点直出气泡（文案池）；p01 空闲心跳 + p02 硬校验（频控/勿扰/全屏静默/语义去重）→ proactive 气泡；dream 定时触发与启动补跑；`idle.rs` 全屏检测真实现。

**Architecture:** 调度器（`packages/harness/src/scheduler/`）是纯生产者——tick 到点只往 InjectionQueue 推条目或调 `onDream` 回调，**不 import gateway、不直接发气泡**（结构测试机器强制）。消费分两路：提醒类条目由陪伴循环侧的 ReminderConsumer 在循环空闲时直出气泡（文案池，零延迟零幻觉）；纪念日/自定义条目留在队列走既有 injection_drain 进下一轮 LLM。心跳 p01 由 `SYS_IDLE_STATE`（壳每 60s 上报）驱动，p02 双重校验（决策前 + 发气泡前），决策与语义去重走 `persona/proactive.ts`（cheap 档，注入进心跳，保持调度器无 LLM 依赖）。

**Tech Stack:** TypeScript ESM（Node 22）、vitest、Rust（Tauri 壳 raw C FFI）。无新第三方依赖——5 段 cron 自己解析（~80 行）。

## Global Constraints（CLAUDE.md 硬边界，每个任务默认遵守）

- 缝①：harness 内 `fetch(`/axios 只许出现在 `packages/harness/src/gateway/client.ts`（结构测试扫描）。
- 缝②：面向用户文本必经 persona 出口或兜底文案池——提醒文案进 `packages/assets/fallback/reminders.json`，不得散落硬编码。
- 缝④：本地数据一律 `$DATA/<userId>/`；新文件 `proactive.json` 走 `resolvePaths`。
- **调度器不直接调 LLM、不直接发气泡**（§3.8）——scheduler/ 目录禁 import `gateway/client`，本计划新增结构测试强制。
- 协议/常量变更先改 `packages/shared`；规格没写的按行业默认 + `// SPEC-GAP: xxx` 内联标注 + 同步 SPEC-GAPS.md（Task 12 汇总）。
- 单文件 ≤300 行；中文注释写「为什么」；Conventional Commits。
- Node 22.x（better-sqlite3 ABI）；测试环境变量 `PETSONA_KEYCHAIN=memory`、`PETSONA_DATA_DIR=<tmp>`。
- 测试命令：`npx vitest run <file>`（单测），`pnpm build && pnpm test`（全量 84+ 用例须全绿）。
- git 提交尾行：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

**既有事实（探索已确认，不要重复造）：**
- InjectionQueue + PreLLM `injection_drain` hook 已存在（M1）：`packages/harness/src/loop/injection_queue.ts`、`main.ts:127-132`。
- 壳每 60s 上报 `SYS_IDLE_STATE {idleMinutes, fullscreen}`（`apps/shell/src-tauri/src/macos/mod.rs`）；harness 侧 handler 是空的（`main.ts:299-301`）。
- `Config.proactive`（frequency/quietHours/fullscreenMute）与 `PROACTIVE_MIN_GAP` 已在 `packages/shared/src/config.ts`。
- `FallbackPool.load()` 装载 `$DATA/fallback/*.json`，bootstrap `copyMissing` 按文件补拷——新增 reminders.json 老用户也能拿到，无需改 bootstrap。
- `GatewayClient.chatOnce(req: LlmChatRequest): Promise<LlmChatResponse>`；`LlmLoop` 已含 `'proactive'`。
- `LocalMemoryStore.dream(): Promise<DreamReport>` 是空实现（返回全零报告）——本计划只接线触发，dream 内部实现是独立后续计划。
- `TRACK.提醒_触发 = 1302`、`TRACK.主动气泡_展示 = 1701`（`packages/shared/src/telemetry.ts`）。

---

### Task 1: 5 段 cron 解析器 `cron_expr.ts`

**Files:**
- Create: `packages/harness/src/scheduler/cron_expr.ts`
- Test: `tests/unit/scheduler.cron-expr.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，零依赖）
- Produces: `cronMatches(expr: string, date: Date): boolean`、`isValidCron(expr: string): boolean`——Task 5 的 CronScheduler 用它判定 cron 类任务到点。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.cron-expr.test.ts
// §3.8 五段 cron：分 时 日 月 周；支持 * , - */n；日与周同时受限时按标准 cron 取 OR
import { describe, expect, it } from 'vitest'
import { cronMatches, isValidCron } from '../../packages/harness/src/scheduler/cron_expr.js'

const d = (s: string) => new Date(s)

describe('cronMatches', () => {
  it('DREAM_CRON 每日 03:30 只在 03:30 命中', () => {
    expect(cronMatches('30 3 * * *', d('2026-07-03T03:30:10'))).toBe(true)
    expect(cronMatches('30 3 * * *', d('2026-07-03T03:31:00'))).toBe(false)
    expect(cronMatches('30 3 * * *', d('2026-07-03T04:30:00'))).toBe(false)
  })
  it('每日 00:00（纪念日/陪伴天数）', () => {
    expect(cronMatches('0 0 * * *', d('2026-07-03T00:00:30'))).toBe(true)
    expect(cronMatches('0 0 * * *', d('2026-07-03T12:00:00'))).toBe(false)
  })
  it('步进 */15 与列表/区间', () => {
    expect(cronMatches('*/15 * * * *', d('2026-07-03T10:45:00'))).toBe(true)
    expect(cronMatches('*/15 * * * *', d('2026-07-03T10:44:00'))).toBe(false)
    expect(cronMatches('0 9,18 * * *', d('2026-07-03T18:00:00'))).toBe(true)
    expect(cronMatches('0 9-11 * * *', d('2026-07-03T10:00:00'))).toBe(true)
    expect(cronMatches('0 9-11 * * *', d('2026-07-03T12:00:00'))).toBe(false)
  })
  it('周日 0 与 7 等价', () => {
    // 2026-07-05 是周日
    expect(cronMatches('0 8 * * 0', d('2026-07-05T08:00:00'))).toBe(true)
    expect(cronMatches('0 8 * * 7', d('2026-07-05T08:00:00'))).toBe(true)
    expect(cronMatches('0 8 * * 1', d('2026-07-05T08:00:00'))).toBe(false)
  })
  it('日与周都受限时取 OR（标准 cron 语义）', () => {
    // 2026-07-03 是周五、3 号
    expect(cronMatches('0 8 3 * 1', d('2026-07-03T08:00:00'))).toBe(true)   // 日命中
    expect(cronMatches('0 8 15 * 5', d('2026-07-03T08:00:00'))).toBe(true)  // 周命中
    expect(cronMatches('0 8 15 * 1', d('2026-07-03T08:00:00'))).toBe(false) // 都不中
  })
  it('非法表达式返回 false 不抛', () => {
    expect(cronMatches('bad', d('2026-07-03T08:00:00'))).toBe(false)
    expect(cronMatches('61 * * * *', d('2026-07-03T08:00:00'))).toBe(false)
    expect(cronMatches('', d('2026-07-03T08:00:00'))).toBe(false)
  })
})

describe('isValidCron', () => {
  it('校验字段数与取值域', () => {
    expect(isValidCron('30 3 * * *')).toBe(true)
    expect(isValidCron('*/5 0-23 1,15 * 0-6')).toBe(true)
    expect(isValidCron('30 3 * *')).toBe(false)
    expect(isValidCron('60 * * * *')).toBe(false)
    expect(isValidCron('* * 0 * *')).toBe(false)   // 日从 1 起
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && npx vitest run tests/unit/scheduler.cron-expr.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/harness/src/scheduler/cron_expr.ts
// 5 段 cron 匹配（分 时 日 月 周）。为什么自己写：仓库零运行时第三方依赖的惯例，
// 需求只有 * , - */n 与标准「日/周同时受限取 OR」，~80 行可控。

type FieldRange = { min: number; max: number }
const FIELDS: FieldRange[] = [
  { min: 0, max: 59 },  // minute
  { min: 0, max: 23 },  // hour
  { min: 1, max: 31 },  // day of month
  { min: 1, max: 12 },  // month
  { min: 0, max: 7 },   // day of week（0 与 7 都是周日）
]

/** 解析单字段为命中集合；非法返回 null */
function parseField(spec: string, range: FieldRange): Set<number> | null {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const step = m[2] ? parseInt(m[2], 10) : 1
    if (step < 1) return null
    let lo: number, hi: number
    if (m[1] === '*') {
      lo = range.min; hi = range.max
    } else if (m[1]!.includes('-')) {
      const [a, b] = m[1]!.split('-').map((x) => parseInt(x, 10))
      lo = a!; hi = b!
    } else {
      lo = hi = parseInt(m[1]!, 10)
      if (m[2]) hi = range.max          // "5/15" 视为 5 起步进（标准行为）
    }
    if (lo < range.min || hi > range.max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size > 0 ? out : null
}

function parse(expr: string): Set<number>[] | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets: Set<number>[] = []
  for (let i = 0; i < 5; i++) {
    const s = parseField(parts[i]!, FIELDS[i]!)
    if (!s) return null
    sets.push(s)
  }
  return sets
}

export function isValidCron(expr: string): boolean {
  return parse(expr) !== null
}

export function cronMatches(expr: string, date: Date): boolean {
  const sets = parse(expr)
  if (!sets) return false
  const [min, hour, dom, mon, dow] = sets
  if (!min!.has(date.getMinutes()) || !hour!.has(date.getHours()) || !mon!.has(date.getMonth() + 1)) return false
  const domHit = dom!.has(date.getDate())
  const dowHit = dow!.has(date.getDay()) || (dow!.has(7) && date.getDay() === 0)
  // 标准 cron：日与周都非 * 时取 OR，否则取 AND（即都得命中，* 恒命中）
  const domAny = dom!.size === FIELDS[2]!.max - FIELDS[2]!.min + 1
  const dowAny = dow!.size >= 7
  if (!domAny && !dowAny) return domHit || dowHit
  return domHit && dowHit
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scheduler.cron-expr.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/scheduler/cron_expr.ts tests/unit/scheduler.cron-expr.test.ts
git commit -m "feat(scheduler): 5 段 cron 解析器（§3.8，零依赖）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `scheduled.json` 持久化 `jobs_store.ts`

**Files:**
- Create: `packages/harness/src/scheduler/jobs_store.ts`
- Test: `tests/unit/scheduler.jobs-store.test.ts`

**Interfaces:**
- Consumes: `CronJob`（`@petsona/shared`）
- Produces: `loadJobs(path: string): CronJob[]`、`saveJobs(path: string, jobs: CronJob[]): void`（只落盘 `durable: true` 的任务；原子写）。Task 5 使用。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.jobs-store.test.ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CronJob } from '@petsona/shared'
import { loadJobs, saveJobs } from '../../packages/harness/src/scheduler/jobs_store.js'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'petsona-jobs-')), 'scheduled.json')

describe('jobs_store', () => {
  it('文件不存在 → []', () => {
    expect(loadJobs(tmp())).toEqual([])
  })
  it('损坏 JSON → []（不抛）', () => {
    const p = tmp()
    writeFileSync(p, '{oops')
    expect(loadJobs(p)).toEqual([])
  })
  it('roundtrip 只持久化 durable 任务', () => {
    const p = tmp()
    const jobs: CronJob[] = [
      { id: 'dream', cron: '30 3 * * *', kind: 'dream', durable: true, lastFiredAt: 123 },
      { id: 'pomodoro', cron: '', kind: 'pomodoro', durable: false, payload: { phase: 'focus' } },
      { id: 'water', cron: '', kind: 'water', durable: true, lastFiredAt: 456 },
    ]
    saveJobs(p, jobs)
    const loaded = loadJobs(p)
    expect(loaded.map((j) => j.id).sort()).toEqual(['dream', 'water'])
    expect(loaded.find((j) => j.id === 'dream')!.lastFiredAt).toBe(123)
  })
  it('非数组内容 → []', () => {
    const p = tmp()
    writeFileSync(p, '{"not":"array"}')
    expect(loadJobs(p)).toEqual([])
  })
  it('写入是完整 JSON（原子写不留 tmp）', () => {
    const p = tmp()
    saveJobs(p, [{ id: 'x', cron: '0 0 * * *', kind: 'anniversary', durable: true }])
    expect(JSON.parse(readFileSync(p, 'utf8'))).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.jobs-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/harness/src/scheduler/jobs_store.ts
// scheduled.json 读写（§3.8 durable 模式：重启存活）。
// 为什么原子写：tick 每 30s 可能落盘，进程被杀时避免半个 JSON 毁掉全部任务。

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { CronJob } from '@petsona/shared'

export function loadJobs(path: string): CronJob[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((j): j is CronJob => typeof j?.id === 'string' && typeof j?.kind === 'string')
  } catch {
    return []   // 损坏当空处理，durable 任务由默认任务兜底重建（dream 在 CronScheduler.start 恢复）
  }
}

export function saveJobs(path: string, jobs: CronJob[]): void {
  const durable = jobs.filter((j) => j.durable)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(durable, null, 2))
  renameSync(tmp, path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scheduler.jobs-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/scheduler/jobs_store.ts tests/unit/scheduler.jobs-store.test.ts
git commit -m "feat(scheduler): scheduled.json 持久化（durable 任务原子落盘）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: p02 硬校验守卫 `guards.ts`（勿扰时段 + 频控 + 全屏静默）

**Files:**
- Create: `packages/harness/src/scheduler/guards.ts`
- Test: `tests/unit/scheduler.guards.test.ts`

**Interfaces:**
- Consumes: `ProactiveFrequency`、`PROACTIVE_MIN_GAP`（`@petsona/shared`）
- Produces:
  - `inQuietHours(now: Date, window: [string, string]): boolean`（"HH:MM" 起止；跨零点窗口；起止相等视为未启用）
  - `type P02Verdict = 'ok' | 'off' | 'gap' | 'quiet' | 'fullscreen'`
  - `p02Gate(input: { frequency: ProactiveFrequency; quietHours: [string, string]; fullscreenMute: boolean; fullscreen: boolean; lastProactiveAt: number; now: number }): P02Verdict`
  Task 7（消费静默）与 Task 9（心跳双校验）使用。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.guards.test.ts
// p02 硬校验（§3.8 / 架构 §4.1）：模型可以想说话，Harness 决定能不能说
import { describe, expect, it } from 'vitest'
import { inQuietHours, p02Gate } from '../../packages/harness/src/scheduler/guards.js'

const at = (s: string) => new Date(`2026-07-03T${s}:00`)

describe('inQuietHours', () => {
  it('跨零点窗口 22:00-09:00', () => {
    expect(inQuietHours(at('23:30'), ['22:00', '09:00'])).toBe(true)
    expect(inQuietHours(at('03:00'), ['22:00', '09:00'])).toBe(true)
    expect(inQuietHours(at('08:59'), ['22:00', '09:00'])).toBe(true)
    expect(inQuietHours(at('09:00'), ['22:00', '09:00'])).toBe(false)
    expect(inQuietHours(at('12:00'), ['22:00', '09:00'])).toBe(false)
  })
  it('同日窗口 12:00-14:00', () => {
    expect(inQuietHours(at('13:00'), ['12:00', '14:00'])).toBe(true)
    expect(inQuietHours(at('14:00'), ['12:00', '14:00'])).toBe(false)
  })
  it('起止相等 = 未启用', () => {
    expect(inQuietHours(at('00:00'), ['00:00', '00:00'])).toBe(false)
  })
})

describe('p02Gate', () => {
  const base = {
    frequency: 'mid' as const,
    quietHours: ['22:00', '09:00'] as [string, string],
    fullscreenMute: true,
    fullscreen: false,
    lastProactiveAt: 0,
    now: at('12:00').getTime(),
  }
  it('频次 off → off', () => {
    expect(p02Gate({ ...base, frequency: 'off' })).toBe('off')
  })
  it('全屏且 fullscreenMute → fullscreen', () => {
    expect(p02Gate({ ...base, fullscreen: true })).toBe('fullscreen')
    expect(p02Gate({ ...base, fullscreen: true, fullscreenMute: false })).toBe('ok')
  })
  it('勿扰时段 → quiet', () => {
    expect(p02Gate({ ...base, now: at('23:00').getTime() })).toBe('quiet')
  })
  it('mid 档 45 分钟频控', () => {
    const now = at('12:00').getTime()
    expect(p02Gate({ ...base, now, lastProactiveAt: now - 44 * 60_000 })).toBe('gap')
    expect(p02Gate({ ...base, now, lastProactiveAt: now - 45 * 60_000 })).toBe('ok')
  })
  it('全通过 → ok', () => {
    expect(p02Gate(base)).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.guards.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/harness/src/scheduler/guards.ts
// p02 频控与勿扰（§3.8 / 架构 p02）：纯函数，心跳与提醒消费共用同一套硬校验

import type { ProactiveFrequency } from '@petsona/shared'
import { PROACTIVE_MIN_GAP } from '@petsona/shared'

/** "HH:MM" → 当日分钟数；解析失败返回 null */
function toMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const v = parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10)
  return v < 24 * 60 ? v : null
}

export function inQuietHours(now: Date, window: [string, string]): boolean {
  const start = toMinutes(window[0])
  const end = toMinutes(window[1])
  if (start === null || end === null || start === end) return false   // 起止相等视为未启用
  const cur = now.getHours() * 60 + now.getMinutes()
  return start < end ? cur >= start && cur < end : cur >= start || cur < end   // 跨零点
}

export type P02Verdict = 'ok' | 'off' | 'gap' | 'quiet' | 'fullscreen'

export function p02Gate(input: {
  frequency: ProactiveFrequency
  quietHours: [string, string]
  fullscreenMute: boolean
  fullscreen: boolean
  lastProactiveAt: number
  now: number
}): P02Verdict {
  if (input.frequency === 'off') return 'off'
  if (input.fullscreenMute && input.fullscreen) return 'fullscreen'
  if (inQuietHours(new Date(input.now), input.quietHours)) return 'quiet'
  if (input.now - input.lastProactiveAt < PROACTIVE_MIN_GAP[input.frequency] * 60_000) return 'gap'
  return 'ok'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scheduler.guards.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/scheduler/guards.ts tests/unit/scheduler.guards.test.ts
git commit -m "feat(scheduler): p02 硬校验守卫（频控/勿扰/全屏静默）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: InjectionQueue 过滤 drain + CompanionLoop 忙碌探针

**Files:**
- Modify: `packages/harness/src/loop/injection_queue.ts`
- Modify: `packages/harness/src/loop/companion.ts:35`（`private busy` 加只读 getter）
- Modify: `packages/harness/src/main.ts:127-132`（injection_drain 跳过提醒条目）
- Test: `tests/unit/scheduler.queue.test.ts`

**Interfaces:**
- Consumes: 既有 `InjectionQueue.push/drain`
- Produces:
  - `InjectionQueue.drain(now?: number, eligible?: (i: InjectionItem) => boolean): InjectionItem[]`（既有语义不变，新增可选过滤）
  - `InjectionQueue.drainWhere(pred: (i: InjectionItem) => boolean, now?: number): InjectionItem[]`（谓词命中全取，不限 3 条）
  - `CompanionLoop.isBusy: boolean`（getter）
  Task 7 的消费器依赖 `drainWhere` 与 `isBusy`；提醒条目约定 `content` 以 `<reminder ` 开头（Task 5 生产、Task 7 消费、injection_drain 排除——避免同一条提醒既进 LLM 又直出气泡的双重播报）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.queue.test.ts
import { describe, expect, it } from 'vitest'
import { InjectionQueue } from '../../packages/harness/src/loop/injection_queue.js'

const reminder = (kind: string) => ({
  source: 'cron' as const, priority: 2 as const,
  content: `<reminder kind="${kind}"/>`, dedupeKey: `reminder:${kind}`,
})

describe('InjectionQueue M3 扩展', () => {
  it('drain 带 eligible 过滤：提醒条目留在队里', () => {
    const q = new InjectionQueue()
    q.push(reminder('water'))
    q.push({ source: 'task', priority: 1, content: '<task-result/>' })
    const items = q.drain(Date.now(), (i) => !i.content.startsWith('<reminder '))
    expect(items.map((i) => i.source)).toEqual(['task'])
    expect(q.size).toBe(1)   // 提醒还在
  })
  it('drainWhere 只取命中谓词的条目', () => {
    const q = new InjectionQueue()
    q.push(reminder('water'))
    q.push(reminder('stand'))
    q.push({ source: 'system', priority: 3, content: '<sys/>' })
    const items = q.drainWhere((i) => i.content.startsWith('<reminder '))
    expect(items).toHaveLength(2)
    expect(q.size).toBe(1)
  })
  it('drainWhere 丢弃过期条目', () => {
    const q = new InjectionQueue()
    q.push({ ...reminder('water'), expiresAt: 1000 })
    expect(q.drainWhere(() => true, 2000)).toEqual([])
  })
  it('drain 不带过滤时行为不变（priority 排序、最多 3 条）', () => {
    const q = new InjectionQueue()
    for (const p of [3, 1, 2, 3] as const) q.push({ source: 'system', priority: p, content: `p${p}-${Math.random()}` })
    const items = q.drain()
    expect(items.map((i) => i.priority)).toEqual([1, 2, 3])
    expect(q.size).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.queue.test.ts`
Expected: FAIL（drain 第二参不生效 / drainWhere 不存在）

- [ ] **Step 3: Write implementation**

`packages/harness/src/loop/injection_queue.ts` 中 `drain` 替换为、并新增 `drainWhere`：

```ts
  drain(now = Date.now(), eligible: (i: InjectionItem) => boolean = () => true): InjectionItem[] {
    this.items = this.items.filter((i) => !i.expiresAt || i.expiresAt > now)
    const sorted = this.items.filter(eligible).sort((a, b) => a.priority - b.priority)
    const taken = sorted.slice(0, INJECTION_MAX_PER_TURN)
    this.items = this.items.filter((i) => !taken.includes(i))
    return taken
  }

  /** 谓词命中全取（不限 3 条）——提醒消费器用；过期项同样先丢弃 */
  drainWhere(pred: (i: InjectionItem) => boolean, now = Date.now()): InjectionItem[] {
    this.items = this.items.filter((i) => !i.expiresAt || i.expiresAt > now)
    const taken = this.items.filter(pred)
    this.items = this.items.filter((i) => !taken.includes(i))
    return taken
  }
```

`packages/harness/src/loop/companion.ts` `CompanionLoop` 类内（`private busy = false` 之后）加：

```ts
  /** 提醒消费器只在循环空闲时直出气泡（§3.8 陪伴循环空闲时消费） */
  get isBusy(): boolean {
    return this.busy
  }
```

`packages/harness/src/main.ts` injection_drain hook 改为（原 127-132 行）：

```ts
  hooks.onPreLLM('injection_drain', async (ctx) => {
    // 提醒条目（<reminder …/>）由 ReminderConsumer 直出气泡，不进 LLM 上下文——避免双重播报
    const items = queue.drain(Date.now(), (i) => !i.content.startsWith('<reminder '))
    if (items.length) {
      ctx.messages.push({ role: 'user', content: items.map((i) => i.content).join('\n') })
    }
  })
```

- [ ] **Step 4: Run tests（新用例 + 既有回归）**

Run: `npx vitest run tests/unit/scheduler.queue.test.ts tests/unit/hooks.pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/loop/injection_queue.ts packages/harness/src/loop/companion.ts packages/harness/src/main.ts tests/unit/scheduler.queue.test.ts
git commit -m "feat(loop): 注入队列过滤 drain + 陪伴循环忙碌探针（M3 提醒消费前置）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 调度器主体 `cron.ts`（30s tick + REMINDER_SET/STOP 任务构建 + dream 触发/补跑）

**Files:**
- Modify: `packages/shared/src/schedule.ts`（契约常量先行）
- Create: `packages/harness/src/scheduler/cron.ts`
- Test: `tests/unit/scheduler.cron.test.ts`

**Interfaces:**
- Consumes: `cronMatches`（Task 1）、`loadJobs/saveJobs`（Task 2）、`InjectionQueue.push`、`Config`、`ReminderKind`（`@petsona/shared` ipc.ts：`'pomodoro' | 'water' | 'stand'`）
- Produces:
  ```ts
  export type SchedulerDeps = {
    jobsPath: string
    queue: InjectionQueue
    getConfig: () => Config
    onDream: () => Promise<void>       // main.ts 接 store.dream()；调度器不碰 LLM/记忆内部
    now?: () => number                 // 测试注入时钟
  }
  export class CronScheduler {
    constructor(deps: SchedulerDeps)
    start(): void      // 载入 durable + 确保 dream 任务 + dream 补跑判定 + 立即 tick + setInterval(SCHEDULER_TICK_MS)
    stop(): void
    tick(): void       // 测试直调
    setReminder(kind: ReminderKind, cfg?: object): void
    stopReminder(kind: ReminderKind): void
    jobs(): CronJob[]  // 只读快照（测试/调试）
  }
  ```
- 生产的 InjectionItem 形状（Task 7 消费约定）：
  - 提醒：`{ source:'cron', priority:2, content:'<reminder kind="water"/>' 或 '<reminder kind="pomodoro" phase="focus_end"/>', dedupeKey:'reminder:<kind>[:<phase>]', expiresAt: now + REMINDER_EXPIRES_MS }`
  - 纪念日/自定义：`{ source:'cron', priority:2, content:'<cron-reminder kind="anniversary">note</cron-reminder>', dedupeKey:'cron:<id>:<minuteStart>', expiresAt: now + 24h }`（走既有 LLM 注入，非消费器）
- shared 新增：`export const REMINDER_EXPIRES_MS = 10 * 60_000`

- [ ] **Step 1: shared 契约常量（先改 shared 再写实现，CLAUDE.md 纪律）**

`packages/shared/src/schedule.ts` 末尾追加：

```ts
// SPEC-GAP: 规格未定义提醒条目滞留上限；全屏/勿扰压住 10 分钟后直接过期丢弃，避免堆积轰炸
export const REMINDER_EXPIRES_MS = 10 * 60_000
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/scheduler.cron.test.ts
// §3.8：30s tick 读 scheduled.json → InjectionItem 入队；调度器不调 LLM、不发气泡
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, DREAM_CATCHUP_HOURS } from '@petsona/shared'
import { InjectionQueue } from '../../packages/harness/src/loop/injection_queue.js'
import { CronScheduler } from '../../packages/harness/src/scheduler/cron.js'
import { loadJobs, saveJobs } from '../../packages/harness/src/scheduler/jobs_store.js'

const MIN = 60_000
let queue: InjectionQueue
let jobsPath: string
let clock: number
let dreamRuns: number

function makeScheduler() {
  return new CronScheduler({
    jobsPath, queue,
    getConfig: () => DEFAULT_CONFIG,
    onDream: async () => { dreamRuns++ },
    now: () => clock,
  })
}

beforeEach(() => {
  queue = new InjectionQueue()
  jobsPath = join(mkdtempSync(join(tmpdir(), 'petsona-cron-')), 'scheduled.json')
  clock = new Date('2026-07-03T12:00:00').getTime()
  dreamRuns = 0
})

describe('CronScheduler', () => {
  it('start 确保 dream 任务存在且 lastFiredAt 初始化为 now（首装不补跑）', () => {
    const s = makeScheduler()
    s.start(); s.stop()
    const dream = s.jobs().find((j) => j.kind === 'dream')!
    expect(dream.cron).toBe('30 3 * * *')
    expect(dream.lastFiredAt).toBe(clock)
    expect(dreamRuns).toBe(0)
  })
  it('距上次 dream >20h 启动补跑', () => {
    saveJobs(jobsPath, [{ id: 'dream', cron: '30 3 * * *', kind: 'dream', durable: true,
      lastFiredAt: clock - (DREAM_CATCHUP_HOURS + 1) * 3600_000 }])
    const s = makeScheduler()
    s.start(); s.stop()
    expect(dreamRuns).toBe(1)
  })
  it('cron 任务到点触发一次，同一分钟第二次 tick 不重复', () => {
    saveJobs(jobsPath, [{ id: 'anniv', cron: '0 12 * * *', kind: 'anniversary', durable: true,
      payload: { note: '陪伴 100 天' }, lastFiredAt: 0 }])
    const s = makeScheduler()
    s.start(); s.stop()   // start 载盘并立即 tick 一次（12:00 命中）
    s.tick()              // 同一分钟第二次 tick（模拟 30s 间隔）不重复
    const items = queue.drainWhere(() => true)
    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('陪伴 100 天')
    expect(items[0]!.content).toMatch(/^<cron-reminder /)
  })
  it('water 间隔任务按 config.reminders.waterMin 触发并产出 <reminder>', () => {
    const s = makeScheduler()
    s.setReminder('water')
    clock += 59 * MIN; s.tick()
    expect(queue.size).toBe(0)
    clock += 1 * MIN; s.tick()
    const items = queue.drainWhere(() => true)
    expect(items[0]!.content).toBe('<reminder kind="water"/>')
    expect(items[0]!.priority).toBe(2)
  })
  it('pomodoro：SET 立即 focus_start，焦点段结束 focus_end，休息段结束 rest_end，STOP 发 abort', () => {
    const s = makeScheduler()
    s.setReminder('pomodoro', { focusMin: 25, restMin: 5 })
    expect(queue.drainWhere(() => true)[0]!.content).toBe('<reminder kind="pomodoro" phase="focus_start"/>')
    clock += 25 * MIN; s.tick()
    expect(queue.drainWhere(() => true)[0]!.content).toBe('<reminder kind="pomodoro" phase="focus_end"/>')
    clock += 5 * MIN; s.tick()
    expect(queue.drainWhere(() => true)[0]!.content).toBe('<reminder kind="pomodoro" phase="rest_end"/>')
    s.stopReminder('pomodoro')
    expect(queue.drainWhere(() => true)[0]!.content).toBe('<reminder kind="pomodoro" phase="abort"/>')
    expect(s.jobs().find((j) => j.kind === 'pomodoro')).toBeUndefined()
  })
  it('water/stand durable 落盘、pomodoro 不落盘；stopReminder 从盘上移除', () => {
    const s = makeScheduler()
    s.setReminder('water'); s.setReminder('pomodoro')
    const onDisk = loadJobs(jobsPath)
    expect(onDisk.map((j) => j.kind)).toContain('water')
    expect(onDisk.map((j) => j.kind)).not.toContain('pomodoro')
    s.stopReminder('water')
    expect(loadJobs(jobsPath).map((j) => j.kind)).not.toContain('water')
  })
  it('dream 到点走 onDream 回调，不入注入队列', () => {
    const s = makeScheduler()
    s.start(); s.stop()
    clock = new Date('2026-07-04T03:30:10').getTime()
    s.tick()
    expect(dreamRuns).toBe(1)
    expect(queue.size).toBe(0)
  })
  it('重复 setReminder 同 kind 只保留一个任务', () => {
    const s = makeScheduler()
    s.setReminder('water'); s.setReminder('water')
    expect(s.jobs().filter((j) => j.kind === 'water')).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.cron.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: Write implementation**

```ts
// packages/harness/src/scheduler/cron.ts
// s14 调度器（§3.8）：30s tick 读 scheduled.json → InjectionItem 入队。
// 硬边界：不 import gateway、不 emit——到点只生产队列条目或调 onDream 回调（结构测试强制）。

import type { Config, CronJob, ReminderKind } from '@petsona/shared'
import { DREAM_CATCHUP_HOURS, DREAM_CRON, REMINDER_EXPIRES_MS, SCHEDULER_TICK_MS } from '@petsona/shared'
import type { InjectionQueue } from '../loop/injection_queue.js'
import { cronMatches } from './cron_expr.js'
import { loadJobs, saveJobs } from './jobs_store.js'

// SPEC-GAP: 5 段 cron 表达不了「每 45 分钟」类任意间隔；water/stand/pomodoro 走
// lastFiredAt + 间隔的到期判定，间隔从 config（water/stand 实时读）或 payload（pomodoro 会话内）取
type PomodoroPayload = { focusMin: number; restMin: number; phase: 'focus' | 'rest'; count: number }

export type SchedulerDeps = {
  jobsPath: string
  queue: InjectionQueue
  getConfig: () => Config
  onDream: () => Promise<void>
  now?: () => number
}

export class CronScheduler {
  private list: CronJob[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number

  constructor(private deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.list = loadJobs(this.deps.jobsPath)
    this.ensureDream()
    this.tick()
    this.timer = setInterval(() => this.tick(), SCHEDULER_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  jobs(): CronJob[] {
    return this.list.map((j) => ({ ...j }))
  }

  tick(): void {
    const now = this.now()
    let dirty = false
    for (const job of this.list) {
      if (!this.due(job, now)) continue
      this.fire(job, now)
      job.lastFiredAt = now
      dirty = dirty || job.durable
    }
    if (dirty) this.persist()
  }

  setReminder(kind: ReminderKind, cfg?: object): void {
    this.list = this.list.filter((j) => j.kind !== kind)   // 同 kind 只一个
    const now = this.now()
    if (kind === 'pomodoro') {
      const base = this.deps.getConfig().reminders.pomodoro
      const c = { ...base, ...(cfg as Partial<PomodoroPayload> | undefined) }
      const payload: PomodoroPayload = { focusMin: c.focusMin, restMin: c.restMin, phase: 'focus', count: 0 }
      // SPEC-GAP: 番茄钟是会话态，重启后不恢复（durable=false）——中断的专注段没有意义
      this.list.push({ id: 'pomodoro', cron: '', kind, payload, durable: false, lastFiredAt: now })
      this.pushReminder('pomodoro', 'focus_start', now)
    } else {
      this.list.push({ id: kind, cron: '', kind, durable: true, lastFiredAt: now })
    }
    this.persist()
  }

  stopReminder(kind: ReminderKind): void {
    const existed = this.list.some((j) => j.kind === kind)
    this.list = this.list.filter((j) => j.kind !== kind)
    if (kind === 'pomodoro' && existed) this.pushReminder('pomodoro', 'abort', this.now())
    this.persist()
  }

  // ---- 内部 ----

  private due(job: CronJob, now: number): boolean {
    if (job.kind === 'pomodoro' || job.kind === 'water' || job.kind === 'stand') {
      return now - (job.lastFiredAt ?? 0) >= this.intervalMin(job) * 60_000
    }
    // cron 类（dream/anniversary/custom）：命中当前分钟且本分钟未触发过（tick 每 30s 会进两次）
    const minuteStart = Math.floor(now / 60_000) * 60_000
    return cronMatches(job.cron, new Date(now)) && (job.lastFiredAt ?? 0) < minuteStart
  }

  private intervalMin(job: CronJob): number {
    const cfg = this.deps.getConfig()
    if (job.kind === 'water') return cfg.reminders.waterMin
    if (job.kind === 'stand') return cfg.reminders.standMin
    const p = job.payload as PomodoroPayload
    return p.phase === 'focus' ? p.focusMin : p.restMin
  }

  private fire(job: CronJob, now: number): void {
    switch (job.kind) {
      case 'dream':
        void this.deps.onDream().catch((err) => console.error('[scheduler] dream 失败:', err))
        return
      case 'pomodoro': {
        const p = job.payload as PomodoroPayload
        this.pushReminder('pomodoro', p.phase === 'focus' ? 'focus_end' : 'rest_end', now)
        job.payload = p.phase === 'focus'
          ? { ...p, phase: 'rest', count: p.count + 1 }
          : { ...p, phase: 'focus' }
        return
      }
      case 'water':
      case 'stand':
        this.pushReminder(job.kind, undefined, now)
        return
      default: {   // anniversary / custom：进 LLM 注入（下一轮对话第一句提起，架构 §4.2）
        const note = (job.payload as { note?: string } | undefined)?.note ?? job.id
        const minuteStart = Math.floor(now / 60_000) * 60_000
        this.deps.queue.push({
          source: 'cron', priority: 2,
          content: `<cron-reminder kind="${job.kind}">${note}</cron-reminder>`,
          dedupeKey: `cron:${job.id}:${minuteStart}`,
          expiresAt: now + 24 * 3600_000,
        })
      }
    }
  }

  private pushReminder(kind: ReminderKind, phase: string | undefined, now: number): void {
    this.deps.queue.push({
      source: 'cron', priority: 2,
      content: phase ? `<reminder kind="${kind}" phase="${phase}"/>` : `<reminder kind="${kind}"/>`,
      // 常量 dedupeKey：静默压住的旧提醒还没消费时不再堆新的（回来只看到一条）
      dedupeKey: phase ? `reminder:${kind}:${phase}` : `reminder:${kind}`,
      expiresAt: now + REMINDER_EXPIRES_MS,
    })
  }

  private ensureDream(): void {
    let dream = this.list.find((j) => j.kind === 'dream')
    if (!dream) {
      // lastFiredAt 初始化为 now：首装不把「从未跑过」当成错过（补跑只针对真正错过的 03:30）
      dream = { id: 'dream', cron: DREAM_CRON, kind: 'dream', durable: true, lastFiredAt: this.now() }
      this.list.push(dream)
      this.persist()
      return
    }
    if (this.now() - (dream.lastFiredAt ?? 0) > DREAM_CATCHUP_HOURS * 3600_000) {
      void this.deps.onDream().catch((err) => console.error('[scheduler] dream 补跑失败:', err))
      dream.lastFiredAt = this.now()
      this.persist()
    }
  }

  private persist(): void {
    try {
      saveJobs(this.deps.jobsPath, this.list)
    } catch (err) {
      console.error('[scheduler] scheduled.json 落盘失败:', err)
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @petsona/shared build && npx vitest run tests/unit/scheduler.cron.test.ts`
Expected: PASS（shared 先重建，REMINDER_EXPIRES_MS 才可 import）

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schedule.ts packages/harness/src/scheduler/cron.ts tests/unit/scheduler.cron.test.ts
git commit -m "feat(scheduler): 30s tick 调度器（cron/间隔任务/番茄钟状态机/dream 触发与补跑）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 提醒文案池 `reminders.json`

**Files:**
- Create: `packages/assets/fallback/reminders.json`
- Test: `tests/unit/scheduler.reminders-pool.test.ts`

**Interfaces:**
- Consumes: `FallbackPool.load/pick`（既有，load 装载目录下全部 *.json，bootstrap `copyMissing` 按文件补拷老用户目录）
- Produces: 文案池 key 约定（Task 7 消费器用）：`reminder_pomodoro_focus_start` / `reminder_pomodoro_focus_end` / `reminder_pomodoro_rest_end` / `reminder_pomodoro_abort` / `reminder_water` / `reminder_stand`，每 key ≥3 变体（§7 文案池纪律）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.reminders-pool.test.ts
// 缝②：提醒文案只进文案池，不散落代码（P-POMODORO/HEALTH-NUDGE 的文案池直出档，架构 §4.2）
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FallbackPool } from '../../packages/harness/src/persona/fallback_pool.js'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../packages/assets/fallback')
const KEYS = [
  'reminder_pomodoro_focus_start', 'reminder_pomodoro_focus_end',
  'reminder_pomodoro_rest_end', 'reminder_pomodoro_abort',
  'reminder_water', 'reminder_stand',
]

describe('提醒文案池', () => {
  it('六个 key 全部存在且每个 ≥3 变体、≤25 字', async () => {
    const raw = (await import('node:fs')).readFileSync(join(ASSETS, 'reminders.json'), 'utf8')
    const data = JSON.parse(raw) as Record<string, string[]>
    for (const key of KEYS) {
      expect(data[key], key).toBeDefined()
      expect(data[key]!.length, key).toBeGreaterThanOrEqual(3)
      for (const line of data[key]!) expect(line.length, `${key}: ${line}`).toBeLessThanOrEqual(25)
    }
  })
  it('FallbackPool 能装载并轮换', () => {
    const pool = new FallbackPool()
    pool.load(ASSETS)
    const a = pool.pick('reminder_water')
    const b = pool.pick('reminder_water')
    expect(a).not.toBe(b)   // 变体轮换，连续触发不重复
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.reminders-pool.test.ts`
Expected: FAIL（reminders.json 不存在）

- [ ] **Step 3: Write the asset**

```json
{
  "reminder_pomodoro_focus_start": [
    "开工啦人～计时开始喵",
    "专注模式启动！我帮你守着时间",
    "冲鸭，这一轮我不吵你"
  ],
  "reminder_pomodoro_focus_end": [
    "时间到啦，伸个懒腰嘛~",
    "叮！这一轮结束，歇会儿喵",
    "辛苦啦，起来活动活动爪子"
  ],
  "reminder_pomodoro_rest_end": [
    "呜……该回去啦，加油呀",
    "休息结束，下一轮开始喵",
    "满血复活！继续继续~"
  ],
  "reminder_pomodoro_abort": [
    "不想专注啦？我陪你摸鱼喵",
    "好嘛好嘛，番茄钟先收起来",
    "那就歇着吧，我也躺会儿"
  ],
  "reminder_water": [
    "倒水啦倒水啦，咕咚咕咚喵",
    "喝口水嘛，嗓子要冒烟啦",
    "水水时间到！咕噜咕噜"
  ],
  "reminder_stand": [
    "站起来走两步嘛~爪子都僵了",
    "起来伸展一下呀，别长在椅子上",
    "遛遛自己吧，我也想动动"
  ]
}
```

保存为 `packages/assets/fallback/reminders.json`（UTF-8）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scheduler.reminders-pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/assets/fallback/reminders.json tests/unit/scheduler.reminders-pool.test.ts
git commit -m "feat(assets): 番茄钟/喝水/站立提醒文案池（缝②文案池直出档）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 提醒消费器 `reminder_consumer.ts`

**Files:**
- Create: `packages/harness/src/loop/reminder_consumer.ts`
- Test: `tests/unit/scheduler.consumer.test.ts`

**Interfaces:**
- Consumes: `InjectionQueue.drainWhere/push`（Task 4）、`inQuietHours`（Task 3）、`FallbackPool.pick`、文案池 key（Task 6）、`IPC.REMINDER_FIRED / IPC.PET_BUBBLE`、`TRACK.提醒_触发 = 1302`
- Produces:
  ```ts
  export const CONSUMER_TICK_MS = 5_000
  export type ConsumerDeps = {
    queue: InjectionQueue
    pool: FallbackPool
    getConfig: () => Config
    getFullscreen: () => boolean
    isLoopBusy: () => boolean
    emit: (e: { type: string; payload: unknown }) => void
    track: (eventId: number, props: Record<string, unknown>) => void
    now?: () => number
  }
  export class ReminderConsumer {
    constructor(deps: ConsumerDeps)
    start(): void   // setInterval(CONSUMER_TICK_MS)
    stop(): void
    tick(): void    // 测试直调
  }
  ```
  行为：循环忙 → 跳过本 tick；drainWhere 取 `content` 以 `<reminder ` 开头的条目；勿扰/全屏静默 → 条目原样 push 回队列（保留 expiresAt，到期自然丢弃）；否则解析 kind/phase → `pool.pick('reminder_<kind>[_<phase>]')` → emit `REMINDER_FIRED {kind, phase?, petLine}` + `PET_BUBBLE {text, durationMs: 8000, kind: 'reminder'}` + `track(1302)`。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.consumer.test.ts
// §3.8 消费侧：调度器只生产，气泡由陪伴循环侧消费器直出（文案池，准点零延迟）
import { beforeEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, type Config } from '@petsona/shared'
import { InjectionQueue } from '../../packages/harness/src/loop/injection_queue.js'
import { FallbackPool } from '../../packages/harness/src/persona/fallback_pool.js'
import { ReminderConsumer } from '../../packages/harness/src/loop/reminder_consumer.js'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../packages/assets/fallback')
const NOON = new Date('2026-07-03T12:00:00').getTime()

let queue: InjectionQueue
let emitted: { type: string; payload: any }[]
let tracked: number[]
let cfg: Config
let fullscreen: boolean
let busy: boolean

function makeConsumer() {
  const pool = new FallbackPool()
  pool.load(ASSETS)
  return new ReminderConsumer({
    queue, pool,
    getConfig: () => cfg,
    getFullscreen: () => fullscreen,
    isLoopBusy: () => busy,
    emit: (e) => emitted.push(e as any),
    track: (id) => tracked.push(id),
    now: () => NOON,
  })
}

beforeEach(() => {
  queue = new InjectionQueue()
  emitted = []; tracked = []
  cfg = { ...DEFAULT_CONFIG, proactive: { frequency: 'mid', quietHours: ['22:00', '09:00'], fullscreenMute: true } }
  fullscreen = false; busy = false
})

const pushWater = () => queue.push({
  source: 'cron', priority: 2, content: '<reminder kind="water"/>',
  dedupeKey: 'reminder:water', expiresAt: NOON + 600_000,
})

describe('ReminderConsumer', () => {
  it('直出 REMINDER_FIRED + PET_BUBBLE(kind reminder) + 埋点 1302', () => {
    pushWater()
    makeConsumer().tick()
    const fired = emitted.find((e) => e.type === 'REMINDER_FIRED')!
    expect(fired.payload.kind).toBe('water')
    expect(typeof fired.payload.petLine).toBe('string')
    const bubble = emitted.find((e) => e.type === 'PET_BUBBLE')!
    expect(bubble.payload.kind).toBe('reminder')
    expect(bubble.payload.text).toBe(fired.payload.petLine)
    expect(tracked).toContain(1302)
  })
  it('phase 条目映射 phase 文案 key', () => {
    queue.push({ source: 'cron', priority: 2, content: '<reminder kind="pomodoro" phase="focus_end"/>',
      dedupeKey: 'reminder:pomodoro:focus_end', expiresAt: NOON + 600_000 })
    makeConsumer().tick()
    const fired = emitted.find((e) => e.type === 'REMINDER_FIRED')!
    expect(fired.payload.phase).toBe('focus_end')
  })
  it('循环忙 → 本 tick 不消费，条目还在', () => {
    busy = true
    pushWater()
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
  it('全屏静默 → 押回队列（不发不丢）', () => {
    fullscreen = true
    pushWater()
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
  it('勿扰时段 → 押回队列', () => {
    cfg = { ...cfg, proactive: { ...cfg.proactive, quietHours: ['00:00', '23:59'] } }
    pushWater()
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
  it('非提醒条目不动（留给 LLM 注入）', () => {
    queue.push({ source: 'task', priority: 1, content: '<task-result/>' })
    makeConsumer().tick()
    expect(emitted).toEqual([])
    expect(queue.size).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.consumer.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write implementation**

```ts
// packages/harness/src/loop/reminder_consumer.ts
// 提醒消费器（§3.8「陪伴循环空闲时消费」+ 架构 §4.2 文案池直出档）：
// 为什么不进 LLM——提醒要准点、零延迟、零幻觉；LLM 注入留给任务结果/纪念日这类要人格化播报的条目。

import type { Config } from '@petsona/shared'
import { IPC, TRACK } from '@petsona/shared'
import type { InjectionQueue } from './injection_queue.js'
import type { FallbackPool } from '../persona/fallback_pool.js'
import { inQuietHours } from '../scheduler/guards.js'

export const CONSUMER_TICK_MS = 5_000   // SPEC-GAP: 消费轮询间隔规格未定，5s 满足「准点」感知

export type ConsumerDeps = {
  queue: InjectionQueue
  pool: FallbackPool
  getConfig: () => Config
  getFullscreen: () => boolean
  isLoopBusy: () => boolean
  emit: (e: { type: string; payload: unknown }) => void
  track: (eventId: number, props: Record<string, unknown>) => void
  now?: () => number
}

const REMINDER_RE = /^<reminder kind="(\w+)"(?: phase="(\w+)")?\/>$/

export class ReminderConsumer {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number

  constructor(private deps: ConsumerDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), CONSUMER_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  tick(): void {
    if (this.deps.isLoopBusy()) return   // 陪伴循环空闲时才消费
    const now = this.now()
    const items = this.deps.queue.drainWhere((i) => i.content.startsWith('<reminder '), now)
    if (!items.length) return
    const p = this.deps.getConfig().proactive
    const muted = (p.fullscreenMute && this.deps.getFullscreen()) || inQuietHours(new Date(now), p.quietHours)
    for (const item of items) {
      if (muted) { this.deps.queue.push(item); continue }   // 押回，expiresAt 到点自然丢弃
      const m = REMINDER_RE.exec(item.content)
      if (!m) continue   // 形状不对直接丢（生产方约定见 CronScheduler.pushReminder）
      const [, kind, phase] = m
      const petLine = this.deps.pool.pick(phase ? `reminder_${kind}_${phase}` : `reminder_${kind}`)
      this.deps.emit({ type: IPC.REMINDER_FIRED, payload: { kind, phase, petLine } })
      this.deps.emit({ type: IPC.PET_BUBBLE, payload: { text: petLine, durationMs: 8000, kind: 'reminder' } })
      this.deps.track(TRACK.提醒_触发, { kind, phase: phase ?? '' })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scheduler.consumer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/loop/reminder_consumer.ts tests/unit/scheduler.consumer.test.ts
git commit -m "feat(loop): 提醒消费器（循环空闲时文案池直出气泡，勿扰/全屏押回）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 主动决策与语义去重 `persona/proactive.ts`（P-PROACTIVE-IDLE cheap 档）

**Files:**
- Modify: `packages/harness/src/persona/assemble.ts:55`（`timeScene` 加 `export`）
- Create: `packages/harness/src/persona/proactive.ts`
- Test: `tests/unit/scheduler.proactive.test.ts`

**Interfaces:**
- Consumes: `GatewayClient.chatOnce`（只取 `chatOnce` 一个方法，测试可传假对象）、`LlmChatResponse`、`timeScene()`
- Produces:
  ```ts
  export type ProactiveInput = {
    idleMinutes: number
    frequency: Exclude<ProactiveFrequency, 'off'>
    personaCore: string          // buildSegments().personaCore，main.ts 接线时传
    lastTopic?: string
  }
  // 返回气泡文案；模型 skip / 解析失败 / 调用异常 → null（p01 静默放弃）
  export async function decideProactive(
    gw: Pick<GatewayClient, 'chatOnce'>, input: ProactiveInput,
  ): Promise<string | null>
  // 与最近 3 条主动气泡语义比对；判定失败（异常/输出不可解析）视为重复 → true（p02 fail-closed）
  export async function isSimilarToRecent(
    gw: Pick<GatewayClient, 'chatOnce'>, text: string, recent: string[],
  ): Promise<boolean>
  ```
  Task 9 的心跳把这两个函数作为 `decide` / `isDuplicate` 注入。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.proactive.test.ts
// P-PROACTIVE-IDLE（提示词体系 §5.2）cheap 档决策 + p02 语义去重（失败视为重复）
import { describe, expect, it } from 'vitest'
import type { LlmChatResponse } from '@petsona/shared'
import { decideProactive, isSimilarToRecent } from '../../packages/harness/src/persona/proactive.js'

const gw = (text: string | Error) => ({
  chatOnce: async (): Promise<LlmChatResponse> => {
    if (text instanceof Error) throw text
    return { content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { in: 1, out: 1 } }
  },
})
const input = { idleMinutes: 30, frequency: 'mid' as const, personaCore: '你是桌宠「宠格」。' }

describe('decideProactive', () => {
  it('should_speak=true 返回文案', async () => {
    const out = await decideProactive(gw('{"should_speak":true,"bubble_text":"下午茶时间到啦喵"}'), input)
    expect(out).toBe('下午茶时间到啦喵')
  })
  it('should_speak=false → null', async () => {
    expect(await decideProactive(gw('{"should_speak":false}'), input)).toBeNull()
  })
  it('JSON 混在文本里也能解析', async () => {
    const out = await decideProactive(gw('好的：{"should_speak":true,"bubble_text":"嗨"}'), input)
    expect(out).toBe('嗨')
  })
  it('解析失败 / 空文案 / 调用异常 → null', async () => {
    expect(await decideProactive(gw('乱码'), input)).toBeNull()
    expect(await decideProactive(gw('{"should_speak":true,"bubble_text":"  "}'), input)).toBeNull()
    expect(await decideProactive(gw(new Error('boom')), input)).toBeNull()
  })
})

describe('isSimilarToRecent', () => {
  it('历史为空 → false（不用调 LLM）', async () => {
    expect(await isSimilarToRecent(gw(new Error('不该被调')), '嗨', [])).toBe(false)
  })
  it('模型判相似 → true / 不相似 → false', async () => {
    expect(await isSimilarToRecent(gw('{"similar":true}'), '嗨', ['嗨呀'])).toBe(true)
    expect(await isSimilarToRecent(gw('{"similar":false}'), '嗨', ['去喝水'])).toBe(false)
  })
  it('判定失败视为重复（p02 fail-closed）', async () => {
    expect(await isSimilarToRecent(gw('乱码'), '嗨', ['嗨呀'])).toBe(true)
    expect(await isSimilarToRecent(gw(new Error('boom')), '嗨', ['嗨呀'])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.proactive.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write implementation**

先给 `packages/harness/src/persona/assemble.ts` 的 `timeScene` 加 `export`（第 55 行 `function timeScene` → `export function timeScene`）。然后：

```ts
// packages/harness/src/persona/proactive.ts
// p01 决策调用（P-PROACTIVE-IDLE，提示词体系 §5.2）+ p02 语义去重（cheap 档，失败视为重复）。
// 为什么放 persona/：这是人格出口的一部分（缝②）；心跳只拿函数注入，scheduler/ 不碰 gateway。

import type { LlmChatResponse, ProactiveFrequency } from '@petsona/shared'
import type { GatewayClient } from '../gateway/client.js'
import { timeScene } from './assemble.js'

const FREQ_LABEL: Record<Exclude<ProactiveFrequency, 'off'>, string> = { high: '多', mid: '中', low: '少' }

export type ProactiveInput = {
  idleMinutes: number
  frequency: Exclude<ProactiveFrequency, 'off'>
  personaCore: string
  lastTopic?: string
}

function textOf(res: LlmChatResponse): string {
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

function parseJson(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export async function decideProactive(
  gw: Pick<GatewayClient, 'chatOnce'>, input: ProactiveInput,
): Promise<string | null> {
  const system = `${input.personaCore}\n\n你现在是主动陪伴决策器。只输出 JSON，不输出其他内容。`
  const user = [
    `用户已经 ${input.idleMinutes} 分钟没和你说话了。${timeScene()}。主动频次设置：${FREQ_LABEL[input.frequency]}。`,
    input.lastTopic ? `最近一次对话的话题：${input.lastTopic}` : '',
    '你决定要不要主动冒一句话（≤25 字）。约束：不能问问题、不催回应（❌「你还在吗」「怎么不理我」）；可以陈述、可以撒娇。',
    '输出 JSON：{"should_speak": true|false, "bubble_text": "气泡里的话"}；不想说就 {"should_speak": false}。',
  ].filter(Boolean).join('\n')
  try {
    const res = await gw.chatOnce({
      tier: 'cheap', system, messages: [{ role: 'user', content: user }],
      stream: false, maxTokens: 200, meta: { loop: 'proactive' },
    })
    const parsed = parseJson(textOf(res))
    if (!parsed || parsed.should_speak !== true) return null
    const text = typeof parsed.bubble_text === 'string' ? parsed.bubble_text.trim() : ''
    return text ? text.slice(0, 50) : null
  } catch {
    return null   // 决策失败 = 这次不说话，静默放弃（主动性是加分项，不值得走兜底气泡）
  }
}

export async function isSimilarToRecent(
  gw: Pick<GatewayClient, 'chatOnce'>, text: string, recent: string[],
): Promise<boolean> {
  if (recent.length === 0) return false
  const user = [
    `候选句："${text}"`,
    `历史句子：\n${recent.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    '候选句与任一历史句语义相近（同一意思换说法）吗？只输出 JSON：{"similar": true|false}',
  ].join('\n')
  try {
    const res = await gw.chatOnce({
      tier: 'cheap', system: '你是语义相似判定器。只输出 JSON。',
      messages: [{ role: 'user', content: user }],
      stream: false, maxTokens: 50, meta: { loop: 'proactive' },
    })
    const parsed = parseJson(textOf(res))
    if (!parsed || typeof parsed.similar !== 'boolean') return true
    return parsed.similar
  } catch {
    return true   // p02 纪律：判定失败视为重复（宁可不说，不重复唠叨）
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scheduler.proactive.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/persona/assemble.ts packages/harness/src/persona/proactive.ts tests/unit/scheduler.proactive.test.ts
git commit -m "feat(persona): P-PROACTIVE-IDLE 决策与语义去重（cheap 档，失败视为重复）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 心跳 `heartbeat.ts`（p01 + p02 双重校验 + 历史持久化）

**Files:**
- Modify: `packages/harness/src/paths.ts`（`DataPaths` 加 `proactive` 字段）
- Create: `packages/harness/src/scheduler/heartbeat.ts`
- Test: `tests/unit/scheduler.heartbeat.test.ts`

**Interfaces:**
- Consumes: `p02Gate`（Task 3）、`SysIdleStatePayload`、`PROACTIVE_MIN_GAP`、`Config`
- Produces:
  ```ts
  export const DECISION_RETRY_MS = 5 * 60_000   // 模型说 skip 后的最小再询问间隔
  export type HeartbeatDeps = {
    getConfig: () => Config
    decide: (input: { idleMinutes: number; frequency: Exclude<ProactiveFrequency, 'off'> }) => Promise<string | null>
    isDuplicate: (text: string, recent: string[]) => Promise<boolean>
    emitProactive: (text: string) => void      // main.ts 负责 PET_BUBBLE + 落轮次 + 埋点
    statePath: string                          // $DATA/<uid>/proactive.json
    now?: () => number
  }
  export class Heartbeat {
    constructor(deps: HeartbeatDeps)
    onIdle(p: SysIdleStatePayload): Promise<void>   // SYS_IDLE_STATE handler 直连
  }
  ```
  - `paths.ts`：`DataPaths` 增加 `proactive: string`，`resolvePaths` 中 `proactive: join(root, 'proactive.json')`（缝④）。
  - 持久化状态 `{ lastProactiveAt: number, recent: string[] }`（重启后频控与语义去重不清零）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.heartbeat.test.ts
// p01 心跳（§3.8）：空闲 ≥ 阈值 → p02 → decide(cheap) → 语义去重 → p02 二次校验 → 发气泡
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type Config } from '@petsona/shared'
import { DECISION_RETRY_MS, Heartbeat } from '../../packages/harness/src/scheduler/heartbeat.js'

const NOON = new Date('2026-07-03T12:00:00').getTime()
let clock: number
let cfg: Config
let spoken: string[]
let decisions: number
let decideResult: string | null
let dupResult: boolean
let statePath: string

function makeHeartbeat() {
  return new Heartbeat({
    getConfig: () => cfg,
    decide: async () => { decisions++; return decideResult },
    isDuplicate: async () => dupResult,
    emitProactive: (t) => spoken.push(t),
    statePath,
    now: () => clock,
  })
}

beforeEach(() => {
  clock = NOON
  cfg = { ...DEFAULT_CONFIG, proactive: { frequency: 'mid', quietHours: ['22:00', '09:00'], fullscreenMute: true } }
  spoken = []; decisions = 0; decideResult = '出来晒晒太阳嘛'; dupResult = false
  statePath = join(mkdtempSync(join(tmpdir(), 'petsona-hb-')), 'proactive.json')
})

describe('Heartbeat p01/p02', () => {
  it('空闲达到阈值（mid=45min）才决策并发气泡，状态落盘', async () => {
    const hb = makeHeartbeat()
    await hb.onIdle({ idleMinutes: 44, fullscreen: false })
    expect(decisions).toBe(0)
    await hb.onIdle({ idleMinutes: 45, fullscreen: false })
    expect(spoken).toEqual(['出来晒晒太阳嘛'])
    const saved = JSON.parse(readFileSync(statePath, 'utf8'))
    expect(saved.lastProactiveAt).toBe(clock)
    expect(saved.recent).toEqual(['出来晒晒太阳嘛'])
  })
  it('frequency=off 不决策', async () => {
    cfg = { ...cfg, proactive: { ...cfg.proactive, frequency: 'off' } }
    await makeHeartbeat().onIdle({ idleMinutes: 999, fullscreen: false })
    expect(decisions).toBe(0)
  })
  it('全屏静默不决策', async () => {
    await makeHeartbeat().onIdle({ idleMinutes: 60, fullscreen: true })
    expect(decisions).toBe(0)
  })
  it('发过一次后 45 分钟内频控拦截', async () => {
    const hb = makeHeartbeat()
    await hb.onIdle({ idleMinutes: 60, fullscreen: false })
    clock += 44 * 60_000
    await hb.onIdle({ idleMinutes: 104, fullscreen: false })
    expect(spoken).toHaveLength(1)
    clock += 1 * 60_000
    await hb.onIdle({ idleMinutes: 105, fullscreen: false })
    expect(spoken).toHaveLength(2)
  })
  it('模型 skip 后 DECISION_RETRY_MS 内不再询问', async () => {
    decideResult = null
    const hb = makeHeartbeat()
    await hb.onIdle({ idleMinutes: 60, fullscreen: false })
    clock += DECISION_RETRY_MS - 1000
    await hb.onIdle({ idleMinutes: 65, fullscreen: false })
    expect(decisions).toBe(1)
    clock += 2000
    await hb.onIdle({ idleMinutes: 65, fullscreen: false })
    expect(decisions).toBe(2)
    expect(spoken).toEqual([])
  })
  it('语义重复 → 不发、不更新 lastProactiveAt', async () => {
    dupResult = true
    await makeHeartbeat().onIdle({ idleMinutes: 60, fullscreen: false })
    expect(spoken).toEqual([])
    expect(existsSync(statePath)).toBe(false)
  })
  it('recent 只保留最近 3 条；重启从盘上恢复频控', async () => {
    const hb = makeHeartbeat()
    for (let i = 0; i < 4; i++) {
      decideResult = `第${i}句`
      await hb.onIdle({ idleMinutes: 60, fullscreen: false })
      clock += 46 * 60_000
    }
    expect(JSON.parse(readFileSync(statePath, 'utf8')).recent).toEqual(['第1句', '第2句', '第3句'])
    // 重启：新实例读同一 statePath，46 分钟内频控仍生效？此时距最后一次已过 46min → 可说
    const hb2 = makeHeartbeat()
    clock -= 45 * 60_000   // 回拨到距上次 1 分钟
    await hb2.onIdle({ idleMinutes: 60, fullscreen: false })
    expect(spoken).toHaveLength(4)   // 频控拦住，没有第 5 条
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scheduler.heartbeat.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write implementation**

`packages/harness/src/paths.ts`：`DataPaths` 类型 `scheduled: string` 之后加一行 `proactive: string`；`resolvePaths` 的对象里 `scheduled: join(root, 'scheduled.json'),` 之后加 `proactive: join(root, 'proactive.json'),`。

```ts
// packages/harness/src/scheduler/heartbeat.ts
// p01 心跳 + p02 硬校验（§3.8）：SYS_IDLE_STATE（壳每 60s）驱动。
// 决策调用（cheap LLM）通过 deps.decide 注入——scheduler/ 不 import gateway（结构测试强制）。
// 双重 p02：决策前一次、发气泡前再一次（决策调用耗时数秒，期间状态可能已变化，§3.8「消费时二次校验」）。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Config, ProactiveFrequency, SysIdleStatePayload } from '@petsona/shared'
import { PROACTIVE_MIN_GAP } from '@petsona/shared'
import { p02Gate } from './guards.js'

// SPEC-GAP: 模型返回 skip 后的再询问间隔规格未定；60s 心跳裸询问会打爆 cheap 档，取 5min
export const DECISION_RETRY_MS = 5 * 60_000

type HeartbeatState = { lastProactiveAt: number; recent: string[] }

export type HeartbeatDeps = {
  getConfig: () => Config
  decide: (input: { idleMinutes: number; frequency: Exclude<ProactiveFrequency, 'off'> }) => Promise<string | null>
  isDuplicate: (text: string, recent: string[]) => Promise<boolean>
  emitProactive: (text: string) => void
  statePath: string
  now?: () => number
}

export class Heartbeat {
  private state: HeartbeatState
  private lastDecisionAt = 0
  private inFlight = false
  private latestFullscreen = false
  private readonly now: () => number

  constructor(private deps: HeartbeatDeps) {
    this.now = deps.now ?? Date.now
    this.state = this.load()
  }

  async onIdle(p: SysIdleStatePayload): Promise<void> {
    this.latestFullscreen = !!p.fullscreen   // 先记录，供在途决策的二次校验用
    if (this.inFlight) return
    const cfg = this.deps.getConfig().proactive
    if (cfg.frequency === 'off') return
    const now = this.now()
    // SPEC-GAP: 空闲阈值规格未单列，取频次档最小间隔（架构 §4.1「阈值由主动说话频次决定」）
    if (p.idleMinutes < PROACTIVE_MIN_GAP[cfg.frequency]) return
    if (now - this.lastDecisionAt < DECISION_RETRY_MS) return
    if (p02Gate({ ...cfg, fullscreen: p.fullscreen, lastProactiveAt: this.state.lastProactiveAt, now }) !== 'ok') return

    this.inFlight = true
    this.lastDecisionAt = now
    try {
      const text = await this.deps.decide({ idleMinutes: p.idleMinutes, frequency: cfg.frequency })
      if (!text) return
      if (await this.deps.isDuplicate(text, this.state.recent)) return
      const cfg2 = this.deps.getConfig().proactive
      if (cfg2.frequency === 'off') return
      if (p02Gate({ ...cfg2, fullscreen: this.latestFullscreen, lastProactiveAt: this.state.lastProactiveAt, now: this.now() }) !== 'ok') return
      this.deps.emitProactive(text)
      this.state = { lastProactiveAt: this.now(), recent: [...this.state.recent, text].slice(-3) }
      this.save()
    } finally {
      this.inFlight = false
    }
  }

  private load(): HeartbeatState {
    if (existsSync(this.deps.statePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.deps.statePath, 'utf8'))
        return {
          lastProactiveAt: typeof parsed.lastProactiveAt === 'number' ? parsed.lastProactiveAt : 0,
          recent: Array.isArray(parsed.recent) ? parsed.recent.filter((x: unknown) => typeof x === 'string').slice(-3) : [],
        }
      } catch { /* 损坏当空 */ }
    }
    return { lastProactiveAt: 0, recent: [] }
  }

  private save(): void {
    try {
      writeFileSync(this.deps.statePath, JSON.stringify(this.state, null, 2))
    } catch (err) {
      console.error('[heartbeat] proactive.json 落盘失败:', err)
    }
  }
}
```

- [ ] **Step 4: Run tests（新用例 + paths 回归）**

Run: `npx vitest run tests/unit/scheduler.heartbeat.test.ts && npx vitest run tests/unit`
Expected: PASS（全部单测）

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/paths.ts packages/harness/src/scheduler/heartbeat.ts tests/unit/scheduler.heartbeat.test.ts
git commit -m "feat(scheduler): p01 心跳（p02 双重校验 + 主动历史持久化）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: main.ts 总装 + REMINDER_SET/STOP + 结构测试 + e2e

**Files:**
- Modify: `packages/harness/src/main.ts`（装配 scheduler/heartbeat/consumer、替换 REMINDER 占位、SYS_IDLE_STATE 接线、shutdown）
- Modify: `tests/unit/structural.test.ts`（新增「调度器不直接调 LLM」缝检查）
- Test: `tests/e2e/scheduler.test.ts`

**Interfaces:**
- Consumes: 前面全部任务的产物
- Produces: 完整可跑的 M3 调度链路；`REMINDER_SET {kind, config?}` → `{ok: true, kind}`；`REMINDER_STOP {kind}` → `{ok: true, kind}`。

- [ ] **Step 1: main.ts 装配（一次改完，e2e 会兜底验证）**

import 区追加：

```ts
import { CronScheduler } from './scheduler/cron.js'
import { Heartbeat } from './scheduler/heartbeat.js'
import { ReminderConsumer } from './loop/reminder_consumer.js'
import { decideProactive, isSimilarToRecent } from './persona/proactive.js'
import { buildSegments } from './persona/assemble.js'
```

（注意：`buildSegments` 已被 companion.ts import，main.ts 原来没有——加了不冲突。）

`const loop = new CompanionLoop({...})`（约 148-151 行）之后插入：

```ts
  // ---- M3 调度与主动性（§3.8）：调度器纯生产，消费与 LLM 决策都在外面接线 ----
  const idleNow = { fullscreen: false }
  const scheduler = new CronScheduler({
    jobsPath: paths.scheduled,
    queue,
    getConfig: () => config.get(),
    onDream: async () => {
      const report = await store.dream()
      console.error('[scheduler] dream 报告:', JSON.stringify(report))
    },
  })
  const consumer = new ReminderConsumer({
    queue, pool,
    getConfig: () => config.get(),
    getFullscreen: () => idleNow.fullscreen,
    isLoopBusy: () => loop.isBusy,
    emit,
    track: (id, props) => tracker.track(id, props),
  })
  const heartbeat = new Heartbeat({
    getConfig: () => config.get(),
    decide: (input) => decideProactive(gateway, {
      ...input,
      personaCore: buildSegments(paths, emotion).personaCore,
    }),
    isDuplicate: (text, recent) => isSimilarToRecent(gateway, text, recent),
    emitProactive: (text) => {
      // 主动气泡落 hot 轮次：下一轮对话模型知道自己刚主动说过什么（SPEC-GAP: 规格未写，取上下文连续性默认）
      db.insertTurn('pet', text, Date.now())
      emit({ type: IPC.PET_BUBBLE, payload: { text, durationMs: 8000, kind: 'proactive' } })
      tracker.track(TRACK.主动气泡_展示, { chars: text.length })
    },
    statePath: paths.proactive,
  })
  scheduler.start()
  consumer.start()
```

REMINDER 占位（原 234-236 行）替换为：

```ts
  // 提醒类（M3 调度器）
  const REMINDER_KINDS = ['pomodoro', 'water', 'stand'] as const
  router.onReq(IPC.REMINDER_SET, async (p: { kind?: string; config?: object }) => {
    const kind = REMINDER_KINDS.find((k) => k === p?.kind)
    if (!kind) throw new IpcError('BAD_REQUEST', `kind 必须是 ${REMINDER_KINDS.join('/')}`)
    scheduler.setReminder(kind, p?.config)
    tracker.track(TRACK.提醒_设置, { kind })
    return { ok: true, kind }
  })
  router.onReq(IPC.REMINDER_STOP, async (p: { kind?: string }) => {
    const kind = REMINDER_KINDS.find((k) => k === p?.kind)
    if (!kind) throw new IpcError('BAD_REQUEST', `kind 必须是 ${REMINDER_KINDS.join('/')}`)
    scheduler.stopReminder(kind)
    return { ok: true, kind }
  })
```

SYS_IDLE_STATE handler（原 299-301 行）替换为：

```ts
  router.onEvent(IPC.SYS_IDLE_STATE, (p: { idleMinutes?: number; fullscreen?: boolean }) => {
    const payload = { idleMinutes: p?.idleMinutes ?? 0, fullscreen: !!p?.fullscreen }
    if (payload.fullscreen !== idleNow.fullscreen) console.error(`[idle] fullscreen=${payload.fullscreen}`)
    idleNow.fullscreen = payload.fullscreen
    void heartbeat.onIdle(payload)
  })
```

shutdown（原 325 行）替换为：

```ts
    shutdown: () => { scheduler.stop(); consumer.stop(); tracker.stop(); db.close() },
```

`_internals`（原 327 行）追加 `scheduler, heartbeat, consumer`（单测钩子）。

- [ ] **Step 2: 结构测试新增「调度器不直接调 LLM」**

`tests/unit/structural.test.ts` 末尾追加（复用文件内既有的 `walk`/`ROOT` 工具）：

```ts
describe('缝（M3 §3.8）：调度器不直接调 LLM、不直接发气泡', () => {
  it('scheduler/ 不 import gateway/client、不出现 emit( 直发', () => {
    const files = walk(join(ROOT, 'packages/harness/src/scheduler'))
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      if (lines.some((l) => /gateway\/client|from ['"]\.\.\/gateway/.test(l))) offenders.push(relative(ROOT, f))
    }
    expect(offenders).toEqual([])
  })
})
```

Run: `npx vitest run tests/unit/structural.test.ts`
Expected: PASS（scheduler/ 目录已存在且干净）

- [ ] **Step 3: Write the failing e2e test**

```ts
// tests/e2e/scheduler.test.ts
// M3 调度链路端到端：预置 scheduled.json 的到期任务 → 启动即 tick → 消费器 5s 内直出气泡；
// REMINDER_SET/STOP 即时反馈（focus_start / abort 条目不等间隔）
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessProc } from '../helpers/harness.js'

let proc: HarnessProc
let dataDir: string
const UID = 'anon-schede2e'

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'petsona-sched-e2e-'))
  writeFileSync(join(dataDir, 'device.json'), JSON.stringify({ deviceId: 'schede2e' }))
  mkdirSync(join(dataDir, UID), { recursive: true })
  // 勿扰关掉（起止相等=未启用）、心跳关掉，测试只看 cron→队列→消费链路
  writeFileSync(join(dataDir, UID, 'config.json'), JSON.stringify({
    gatewayUrl: 'http://127.0.0.1:9',   // 不可达也无妨：本链路不出网
    reminders: { pomodoro: { focusMin: 25, restMin: 5 }, waterMin: 60, standMin: 45 },
    proactive: { frequency: 'off', quietHours: ['00:00', '00:00'], fullscreenMute: false },
    taskBudget: { maxToolCalls: 40, maxTokens: 50000, wallclockMin: 10, approvalWaitMin: 10 },
    scopes: [],
  }))
  // 61 分钟前触发过的 water：启动 tick 立刻到期
  writeFileSync(join(dataDir, UID, 'scheduled.json'), JSON.stringify([
    { id: 'water', cron: '', kind: 'water', durable: true, lastFiredAt: Date.now() - 61 * 60_000 },
  ]))
  proc = new HarnessProc({ PETSONA_DATA_DIR: dataDir })
})

afterAll(() => proc.kill())

describe('M3 调度器 e2e', () => {
  it('预置到期 water 任务 → REMINDER_FIRED + PET_BUBBLE(kind reminder)', async () => {
    const fired = await proc.waitFor((e) => e.type === 'REMINDER_FIRED' && e.payload?.kind === 'water', 15_000)
    expect(typeof fired.payload.petLine).toBe('string')
    expect(fired.payload.petLine.length).toBeGreaterThan(0)
    const bubble = await proc.waitFor((e) => e.type === 'PET_BUBBLE' && e.payload?.kind === 'reminder', 15_000)
    expect(bubble.payload.text).toBe(fired.payload.petLine)
  })
  it('water lastFiredAt 已更新落盘（durable 重启存活）', async () => {
    await proc.waitFor((e) => e.type === 'REMINDER_FIRED', 15_000)
    const onDisk = JSON.parse(readFileSync(join(dataDir, UID, 'scheduled.json'), 'utf8'))
    const water = onDisk.find((j: any) => j.kind === 'water')
    expect(Date.now() - water.lastFiredAt).toBeLessThan(60_000)
    expect(onDisk.find((j: any) => j.kind === 'dream')).toBeDefined()   // 默认 dream 任务已建
  })
  it('REMINDER_SET pomodoro → 即时 focus_start；REMINDER_STOP → abort；不落盘', async () => {
    const res = await proc.request('REMINDER_SET', { kind: 'pomodoro', config: { focusMin: 25, restMin: 5 } })
    expect(res.ok).toBe(true)
    await proc.waitFor((e) => e.type === 'REMINDER_FIRED' && e.payload?.phase === 'focus_start', 15_000)
    await proc.request('REMINDER_STOP', { kind: 'pomodoro' })
    await proc.waitFor((e) => e.type === 'REMINDER_FIRED' && e.payload?.phase === 'abort', 15_000)
    const onDisk = JSON.parse(readFileSync(join(dataDir, UID, 'scheduled.json'), 'utf8'))
    expect(onDisk.find((j: any) => j.kind === 'pomodoro')).toBeUndefined()
  })
  it('REMINDER_SET 非法 kind → BAD_REQUEST', async () => {
    await expect(proc.request('REMINDER_SET', { kind: 'nap' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
```

- [ ] **Step 4: Run to verify e2e fails, then build, then verify passes**

Run: `pnpm build && npx vitest run tests/e2e/scheduler.test.ts`
Expected: 未改 main.ts 前 FAIL（REMINDER_SET 返回占位）；完成 Step 1 后 PASS。
注意 e2e 跑的是 `packages/harness/dist/main.js`——**每次改 harness 源码后必须 `pnpm build` 再跑 e2e**。

- [ ] **Step 5: 全量回归**

Run: `pnpm build && pnpm test`
Expected: 既有 84 用例 + 本计划新增全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/main.ts tests/unit/structural.test.ts tests/e2e/scheduler.test.ts
git commit -m "feat(harness): M3 调度总装（REMINDER_SET/STOP、心跳接线、消费器、结构缝测试、e2e）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 全屏检测真实现 `idle.rs`（fullscreenMute 的输入源）

**Files:**
- Modify: `apps/shell/src-tauri/src/macos/idle.rs`

**Interfaces:**
- Consumes: CoreGraphics/CoreFoundation C API（raw FFI，仓库既有风格——本文件已用此法做空闲检测；无 objc 类 crate 可用，不新增依赖）
- Produces: `pub fn frontmost_fullscreen() -> bool`（真实现替换恒 false 桩）。上报链路（`macos/mod.rs` 每 60s → `SYS_IDLE_STATE.fullscreen`）已存在，不用动。

- [ ] **Step 1: Write implementation**

`apps/shell/src-tauri/src/macos/idle.rs` 整文件替换：

```rust
// 空闲检测：CGEventSourceSecondsSinceLastEventType（HID 全事件）
// 全屏检测：CGWindowList 首个 layer-0 在屏窗口的 bounds 覆盖任一显示器即视为全屏。
// 为什么用 CGWindowList：不需要屏幕录制权限（只读 bounds/layer，不读窗口名）；
// 自家桌宠是高 layer 的 NSPanel，天然被 layer==0 过滤，不会误判自己。

use std::ffi::c_void;

type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFNumberRef = *const c_void;
type CFIndex = isize;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint { x: f64, y: f64 }
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize { width: f64, height: f64 }
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGRect { origin: CGPoint, size: CGSize }

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    static kCGWindowLayer: CFStringRef;
    static kCGWindowBounds: CFStringRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(arr: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: CFIndex) -> *const c_void;
    fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;
    fn CFNumberGetValue(num: CFNumberRef, the_type: CFIndex, out: *mut c_void) -> bool;
    fn CFRelease(cf: *const c_void);
}

const HID_SYSTEM_STATE: u32 = 1;          // kCGEventSourceStateHIDSystemState
const ANY_INPUT_EVENT: u32 = u32::MAX;    // kCGAnyInputEventType
const OPT_ON_SCREEN_ONLY: u32 = 1 << 0;   // kCGWindowListOptionOnScreenOnly
const OPT_EXCLUDE_DESKTOP: u32 = 1 << 4;  // kCGWindowListExcludeDesktopElements
const NULL_WINDOW_ID: u32 = 0;            // kCGNullWindowID
const CF_NUMBER_INT_TYPE: CFIndex = 9;    // kCFNumberIntType

pub fn idle_minutes() -> u64 {
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT) };
    (secs / 60.0) as u64
}

pub fn frontmost_fullscreen() -> bool {
    unsafe {
        let arr = CGWindowListCopyWindowInfo(OPT_ON_SCREEN_ONLY | OPT_EXCLUDE_DESKTOP, NULL_WINDOW_ID);
        if arr.is_null() {
            return false;
        }
        let mut result = false;
        let n = CFArrayGetCount(arr);
        for i in 0..n {
            let dict = CFArrayGetValueAtIndex(arr, i) as CFDictionaryRef;
            if dict.is_null() {
                continue;
            }
            let layer_ref = CFDictionaryGetValue(dict, kCGWindowLayer as *const c_void) as CFNumberRef;
            if layer_ref.is_null() {
                continue;
            }
            let mut layer: i32 = -1;
            if !CFNumberGetValue(layer_ref, CF_NUMBER_INT_TYPE, &mut layer as *mut i32 as *mut c_void) {
                continue;
            }
            if layer != 0 {
                continue; // 菜单栏/Dock/浮窗等非普通层，跳过
            }
            // 数组前到后 = 窗口前到后：首个 layer-0 即前台普通窗口
            let bounds_ref = CFDictionaryGetValue(dict, kCGWindowBounds as *const c_void) as CFDictionaryRef;
            if !bounds_ref.is_null() {
                let mut rect = CGRect::default();
                if CGRectMakeWithDictionaryRepresentation(bounds_ref, &mut rect) {
                    result = covers_any_display(&rect);
                }
            }
            break;
        }
        CFRelease(arr);
        result
    }
}

fn covers_any_display(w: &CGRect) -> bool {
    unsafe {
        let mut ids = [0u32; 8];
        let mut count: u32 = 0;
        if CGGetActiveDisplayList(8, ids.as_mut_ptr(), &mut count) != 0 {
            return false;
        }
        (0..count as usize).any(|i| {
            let d = CGDisplayBounds(ids[i]);
            w.origin.x <= d.origin.x
                && w.origin.y <= d.origin.y
                && w.origin.x + w.size.width >= d.origin.x + d.size.width
                && w.origin.y + w.size.height >= d.origin.y + d.size.height
        })
    }
}
```

- [ ] **Step 2: 编译验证**

Run: `source ~/.cargo/env && cd apps/shell/src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` 无 error（warning 可接受）。

- [ ] **Step 3: 用户手动验收标准（GUI 测试交给用户，给标准即可——见记忆 petsona-verify-with-user）**

写进交接说明，不阻塞本任务提交：
1. `pnpm dev:gateway` + `pnpm --filter @petsona/shell tauri:dev` 起 app。
2. 任意 app 进入全屏（绿灯钮），等 ≤60s，harness stderr 出现 `[idle] fullscreen=true`。
3. 退出全屏，等 ≤60s，出现 `[idle] fullscreen=false`。
4. 全屏状态下到点的喝水提醒不弹；退出全屏后 10 分钟内补弹（超时则丢弃）。

- [ ] **Step 4: Commit**

```bash
git add apps/shell/src-tauri/src/macos/idle.rs
git commit -m "feat(shell): 全屏检测真实现（CGWindowList，fullscreenMute 输入源）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: SPEC-GAPS 回填 + scheduler README 更新 + 全量绿

**Files:**
- Modify: `SPEC-GAPS.md`（表格追加 H18–H22）
- Modify: `packages/harness/src/scheduler/README.md`

**Interfaces:** 无代码；文档与代码内 `// SPEC-GAP:` 标注一一对应。

- [ ] **Step 1: SPEC-GAPS.md 表格追加（沿用现有表格列：编号 | 位置 | 空白 | 默认决策 | 回填建议）**

```markdown
| H18 | scheduler/cron.ts | 5 段 cron 表达不了任意分钟间隔（喝水 60/站立 45） | water/stand/pomodoro 走 lastFiredAt+间隔判定；water/stand 间隔实时读 config，pomodoro 会话内取 payload | 规格 §3.8 补 CronJob 间隔类任务口径 |
| H19 | scheduler/cron.ts | 番茄钟重启恢复未定义 | durable=false：重启丢会话（中断的专注段无意义），water/stand/dream durable | 规格 §3.8 收录 |
| H20 | shared/schedule.ts REMINDER_EXPIRES_MS | 提醒被勿扰/全屏压住后的滞留上限未定义 | 10 分钟过期丢弃（常量 dedupeKey 保证压住期间不堆积） | 规格 §3.8 补消费口径 |
| H21 | scheduler/heartbeat.ts | p01 空闲阈值与模型 skip 后的再询问间隔未定义 | 阈值=频次档最小间隔（PROACTIVE_MIN_GAP）；skip 后 5min 内不再询问 | 规格 §3.8 补 p01 参数表 |
| H22 | main.ts emitProactive | 主动气泡是否落对话历史未定义 | 落 hot 轮次（pet role）：下一轮模型知道自己说过什么，语义去重也有据可查 | 规格 §3.8 收录 |
```

- [ ] **Step 2: scheduler README 更新**

`packages/harness/src/scheduler/README.md` 整文件替换：

```markdown
# scheduler（M3 已交付）

§3.8 落地。纯生产者：**不 import gateway、不 emit**（structural.test.ts 机器强制）。

- `cron_expr.ts` — 5 段 cron 匹配（零依赖，日/周同限取 OR）
- `jobs_store.ts` — scheduled.json 原子读写（只持久化 durable）
- `cron.ts` — 30s tick：cron 类到点/间隔类到期 → InjectionItem 入队；dream 走 onDream 回调（启动补跑 >20h）
- `guards.ts` — p02 硬校验纯函数（频控/勿扰/全屏），心跳与消费器共用
- `heartbeat.ts` — p01：SYS_IDLE_STATE 驱动，p02 双重校验，decide/isDuplicate 由 main.ts 注入（persona/proactive.ts，cheap 档）

消费两路（main.ts 接线）：
- `<reminder …/>` 条目 → `loop/reminder_consumer.ts` 循环空闲时文案池直出（REMINDER_FIRED + PET_BUBBLE）
- 其余（task/anniversary/custom）→ 既有 PreLLM injection_drain 进下一轮对话
```

- [ ] **Step 3: 全量验证**

Run: `pnpm build && pnpm test`
Expected: 全绿（含既有 84 用例）。任何红条修完再提交。

- [ ] **Step 4: Commit**

```bash
git add SPEC-GAPS.md packages/harness/src/scheduler/README.md
git commit -m "docs: M3 调度器 SPEC-GAPS 回填（H18-H22）与 scheduler README 更新" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review 结论（已按 spec 复核）

- **§3.8 覆盖**：30s tick 读 scheduled.json（T5）；InjectionItem 入队、调度器不调 LLM 不发气泡（T5+T10 结构测试）；drain 过期/去重/priority/单轮 3 条（M1 已有，T4 保持回归）；p01 心跳阈值触发（T9）；p02 频次/quietHours/fullscreenMute/语义去重 cheap 失败视为重复（T3/T8/T9）；消费时二次校验（T9）；PET_BUBBLE kind proactive（T10）；dream 每日 03:30 触发 + 错过 >20h 补跑（T5）——dream **内部**记忆整理是独立后续计划（本计划只接 `store.dream()` 现有接口）。
- **功能表 M3 行覆盖**：番茄钟/喝水/站立 CronJob→队列→气泡 + 免打扰/全屏静默（T5/T6/T7）；主动陪伴 p01/p02 不提问不催回（T8 prompt 约束 + T9）。「忽略过则降语气」需要气泡交互回传（BUBBLE_ACTION），依赖 M3 UI，未纳入本计划——已在 T12 的 SPEC-GAPS 之外留给记忆管理页/设置页计划。
- **类型一致性**：`drainWhere(pred, now?)` 签名 T4 定义、T5/T7 使用一致；`<reminder kind phase/>` 形状 T5 生产、T7 正则消费一致；`p02Gate` 入参 T3 定义、T9 展开 `{...cfg, fullscreen, lastProactiveAt, now}` 字段名一致（Config.proactive 的 frequency/quietHours/fullscreenMute 恰好同名）。
- **占位符扫描**：无 TBD/TODO/「适当处理」；所有步骤含完整代码与命令。
```

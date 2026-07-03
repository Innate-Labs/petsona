// panel/Reminders.tsx —— 提醒事项页（Figma 82:2252）：四方卡 + Todo 列表 + FAB
// 提醒走 REMINDER_SET/STOP（schedule_reminder 由 harness 落 cron）；
// SPEC-GAP: 协议无 REMINDER_STATE_GET，卡片开关态本地记忆（lib/local.ts）。
// SPEC-GAP: Todo 无 harness 数据域，M1 暂存 localStorage。

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { Config, ConfigGetRes, ReminderFiredPayload, ReminderKind, ReminderSetPayload } from '@petsona/shared'
import { on, request } from '../lib/ipc'
import { loadPrefs, loadTodos, savePrefs, saveTodos } from '../lib/local'
import type { TodoItem } from '../lib/local'
import { useDialog } from './kit'
import iconExpand from '../assets/figma/icon-expand-18.svg'
import iconDelete from '../assets/figma/icon-delete-28.svg'
import iconCheck from '../assets/figma/icon-check.svg'

type TimedKind = 'pomodoro' | 'water' | 'stand'
type CardDef = { kind: TimedKind; title: string }

const CARDS: CardDef[] = [
  { kind: 'pomodoro', title: '番茄钟' },
  { kind: 'water', title: '喝水提醒' },
  { kind: 'stand', title: '站立提醒' },
]

// 点击卡面时间给的时长选项（分钟）；写回 config.reminders，调度器实时读取
const DURATION_OPTIONS: Record<TimedKind, string[]> = {
  pomodoro: ['15 分钟', '25 分钟', '45 分钟', '60 分钟'],
  water: ['30 分钟', '45 分钟', '60 分钟', '90 分钟', '120 分钟'],
  stand: ['30 分钟', '45 分钟', '60 分钟', '90 分钟'],
}

// 半小时粒度 48 个时间点：用户只挑不填（第四轮验收：免打扰不要手写时间）
const TIME_OPTS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  return `${h}:${i % 2 ? '30' : '00'}`
})

/** 免打扰时段选择：开始/结束两个下拉；跨零点合法（如 22:00–09:00） */
function QuietDialog({ initial, onDone }: { initial: [string, string]; onDone: (v: [string, string] | null) => void }) {
  const [start, setStart] = useState(initial[0])
  const [end, setEnd] = useState(initial[1])
  // config 里的既有值可能不在半小时刻度上（手改过 config.json），并进选项防止 select 显示错位
  const opts = (cur: string) => (TIME_OPTS.includes(cur) ? TIME_OPTS : [cur, ...TIME_OPTS])
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <p className="modal-title">免打扰时段</p>
        <div className="modal-row">
          <select value={start} onChange={(e) => setStart(e.target.value)}>
            {opts(start).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span>至</span>
          <select value={end} onChange={(e) => setEnd(e.target.value)}>
            {opts(end).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <p className="modal-hint">这段时间内不主动打扰你（提醒会押后到时段结束）</p>
        <div className="modal-actions">
          <button className="chip" onClick={() => onDone(null)}>
            取消
          </button>
          <button className="chip chip--doing" onClick={() => onDone([start, end])}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

export function Reminders() {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [todos, setTodos] = useState<TodoItem[]>(loadTodos)
  const [quiet, setQuiet] = useState<[string, string] | null>(null)
  const [quietEditing, setQuietEditing] = useState(false)
  const [mins, setMins] = useState<Record<TimedKind, number> | null>(null)
  const [todoOpen, setTodoOpen] = useState(true)
  const [note, setNote] = useState('')
  const dialog = useDialog()

  useEffect(() => {
    void request<ConfigGetRes>(IPC.CONFIG_GET, {})
      .then(({ config }) => {
        setQuiet(config.proactive.quietHours)
        setMins({
          pomodoro: config.reminders.pomodoro.focusMin,
          water: config.reminders.waterMin,
          stand: config.reminders.standMin,
        })
      })
      .catch(() => {})
    // 提醒触发时刷新一行文案，让页面「活」——气泡另由宠物窗展示
    return on<ReminderFiredPayload>(IPC.REMINDER_FIRED, (p) => setNote(p.petLine))
  }, [])

  const toggle = (kind: ReminderKind) => {
    const running = !!prefs.reminders[kind]
    const next = { ...prefs, reminders: { ...prefs.reminders, [kind]: !running } }
    setPrefs(next)
    savePrefs(next)
    if (running) {
      void request(IPC.REMINDER_STOP, { kind }).catch(() => {})
    } else {
      const payload: ReminderSetPayload = { kind }
      void request(IPC.REMINDER_SET, payload).catch(() => {})
    }
  }

  // 点击卡面时间 → 时长选项 → 写回 config（调度器实时读）；番茄钟进行中则重启会话让新时长立即生效
  const editDuration = (kind: TimedKind) => {
    const cur = mins?.[kind]
    void dialog
      .prompt({
        title: `${CARDS.find((c) => c.kind === kind)!.title}时长`,
        options: DURATION_OPTIONS[kind],
        defaultValue: cur ? `${cur} 分钟` : undefined,
      })
      .then((v) => {
        const n = v ? Number.parseInt(v, 10) : Number.NaN
        if (!Number.isFinite(n) || n <= 0) return
        setMins((m) => (m ? { ...m, [kind]: n } : m))
        return request<ConfigGetRes>(IPC.CONFIG_GET, {})
          .then(({ config }) => {
            const reminders =
              kind === 'pomodoro'
                ? { ...config.reminders, pomodoro: { ...config.reminders.pomodoro, focusMin: n } }
                : { ...config.reminders, [kind === 'water' ? 'waterMin' : 'standMin']: n }
            const patch: Partial<Config> = { reminders }
            return request(IPC.CONFIG_SET, { patch })
          })
          .then(() => {
            // 番茄钟时长存在会话 payload 里（H18），进行中改时长要重启会话；water/stand 实时读 config 无需重启
            if (kind === 'pomodoro' && prefs.reminders.pomodoro) {
              return request(IPC.REMINDER_STOP, { kind }).then(() => request(IPC.REMINDER_SET, { kind }))
            }
          })
      })
      .catch(() => {})
  }

  const applyQuietHours = (next: [string, string] | null) => {
    setQuietEditing(false)
    if (!next) return
    setQuiet(next)
    // 整段覆盖 proactive 会丢其它字段，先取回再并（CONFIG_SET 浅合并语义）
    void request<ConfigGetRes>(IPC.CONFIG_GET, {})
      .then(({ config }) => {
        const patch: Partial<Config> = { proactive: { ...config.proactive, quietHours: next } }
        return request(IPC.CONFIG_SET, { patch })
      })
      .catch(() => {})
  }

  const mutateTodos = (next: TodoItem[]) => {
    setTodos(next)
    saveTodos(next)
  }

  const addTodo = () => {
    void dialog.prompt({ title: '要记点什么？', placeholder: '待办内容' }).then((text) => {
      if (!text?.trim()) return
      const time = new Date().toTimeString().slice(0, 5)
      mutateTodos([...todos, { id: `${Date.now()}`, text: text.trim(), time, done: false }])
    })
  }

  return (
    <>
      <div className="remind-grid">
        {CARDS.map((c) => {
          const running = !!prefs.reminders[c.kind]
          return (
            <div key={c.kind} className={`remind-card${c.kind === 'pomodoro' && running ? ' remind-card--active' : ''}`}>
              <p className="remind-card-title">{c.title}</p>
              <button
                className="remind-card-value remind-card-value--btn"
                title="点击调整时长"
                onClick={() => editDuration(c.kind)}
              >
                {mins ? `${mins[c.kind]}:00` : '—'}
              </button>
              <div className="remind-card-chips">
                <span className={`chip ${running ? 'chip--doing' : 'chip--off'}`}>{running ? '进行中' : '已关闭'}</span>
                <button className="chip" onClick={() => toggle(c.kind)}>
                  {running ? '停止' : '开启'}
                </button>
              </div>
            </div>
          )
        })}
        <div className="remind-card">
          <p className="remind-card-title">免打扰时段</p>
          <div className="remind-card-value remind-card-value--long">{quiet ? quiet.join('–') : '—'}</div>
          <div className="remind-card-chips">
            <span className="chip chip--on">已开启</span>
            <button className="chip" onClick={() => quiet && setQuietEditing(true)}>
              设置
            </button>
          </div>
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 12 }}>
        待提醒
        <img
          src={iconExpand}
          alt="展开/收起"
          style={todoOpen ? undefined : { transform: 'rotate(180deg)' }}
          onClick={() => setTodoOpen((v) => !v)}
        />
      </div>
      {todoOpen &&
        todos.map((t) => (
          <div key={t.id} className={`row${t.done ? ' row--done' : ''}`}>
            <button
              className="todo-check"
              onClick={() => mutateTodos(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
            >
              {t.done && <img src={iconCheck} alt="" />}
            </button>
            <span className="row-title">{t.text}</span>
            <span className="row-time">{t.time}</span>
            <button className="row-del" onClick={() => mutateTodos(todos.filter((x) => x.id !== t.id))}>
              <img src={iconDelete} alt="删除" />
            </button>
          </div>
        ))}
      {todoOpen && todos.length === 0 && <div className="placeholder">还没有待提醒的事，点右下角 + 加一条～</div>}
      {note && <div className="float-tooling" style={{ padding: '8px' }}>{note}</div>}
      <button className="fab" onClick={addTodo} aria-label="新增待办">
        +
      </button>
      {quietEditing && quiet && <QuietDialog initial={quiet} onDone={applyQuietHours} />}
    </>
  )
}

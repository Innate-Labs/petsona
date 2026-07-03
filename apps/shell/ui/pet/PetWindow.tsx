// pet/PetWindow.tsx —— 悬浮宠物窗口：Sprite + Bubble + 整窗拖动 + 动作交互（§4 悬浮宠物窗口行）
//
// 交互契约（第五轮真机验收后修订）：
//   · 单击（无拖动）→ 在 打哈欠/伸懒腰/舔爪子 三个动作间轮换播放，播完回落情绪姿势。
//   · 双击           → 打开主面板。
//   · 拖拽（>4px）   → 整窗随鼠标移动，播放 wave（点击拖拽动作素材只在拖动时出现）。
//   · 右下角猫爪手柄 → 系统级窗口角拖拽缩放。
// 另：待提醒（面板 Todo，localStorage 域）到点在此窗以气泡提示——轮询 30s，见 useTodoAlarm。

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { IPC } from '@petsona/shared'
import type { Emotion, PetBubblePayload, PetEmotionSignalPayload, PetPositionPayload } from '@petsona/shared'
import { isTauri, on, send } from '../lib/ipc'
import { loadTodos, saveTodos } from '../lib/local'
import type { PoseName } from '../lib/character'
import { EmotionMachine } from './EmotionMachine'
import { Sprite } from './Sprite'
import { Bubble } from './Bubble'

// 单击轮换的动作池（第五轮：用户指定这三个；wave 留给拖拽专用）
const CLICK_ACTIONS: PoseName[] = ['yawn', 'stretch', 'cheer']
// 各动作播放窗口：取 AVFoundation 实测时长再收 100ms——必须略短于视频实长，
// 否则 loop 会在计时器到点前兜回第 0 帧，肉眼即「动作重复播了第二遍的开头」
const ACTION_MS: Partial<Record<PoseName, number>> = { yawn: 4650, stretch: 4500, cheer: 4650, wave: 3900 }
// 双击窗口：间隔 <= 此值的两次单击视为双击开面板
const DOUBLE_CLICK_MS = 260
// 待提醒轮询：面板写 localStorage（同源共享），这里每 30s 扫一次到点未通知项
const TODO_POLL_MS = 30_000
// 到点 10 分钟内都算有效提醒（错过窗口不补发，防止启动时旧事项轰炸）
const TODO_GRACE_MIN = 10

/** 待提醒到点 → 宠物气泡。SPEC-GAP: todo 在 M1 是 localStorage/UI 域（无 harness 数据域），
    气泡文案只能壳内拼接（缝②的 persona 出口管的是 harness 生成文本）；todo 迁 harness 后应改走文案池 */
function useTodoAlarm(fire: (bubble: PetBubblePayload) => void) {
  useEffect(() => {
    const check = () => {
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const today = now.toISOString().slice(0, 10)
      const todos = loadTodos()
      let changed = false
      const due: string[] = []
      for (const t of todos) {
        if (t.done || t.notifiedOn === today) continue
        const m = t.time.match(/^(\d{1,2}):(\d{2})$/)
        if (!m) continue
        const tMin = Number(m[1]) * 60 + Number(m[2])
        if (nowMin - tMin >= 0 && nowMin - tMin <= TODO_GRACE_MIN) {
          due.push(t.text)
          t.notifiedOn = today
          changed = true
        }
      }
      if (changed) saveTodos(todos)
      if (due.length > 0) fire({ kind: 'reminder', text: `叮～到点啦，别忘了：${due.join('、')}`, durationMs: 15_000 })
    }
    check()
    const timer = setInterval(check, TODO_POLL_MS)
    return () => clearInterval(timer)
    // fire 由调用方保证稳定（setState），不进依赖免得反复重建定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function PetWindow() {
  // 为什么放 ref 不放 state：状态机实例要跨渲染存活，重建会丢驻留计时与切换额度
  const machineRef = useRef<EmotionMachine | null>(null)
  if (machineRef.current === null) machineRef.current = new EmotionMachine()
  const machine = machineRef.current

  const [emotion, setEmotion] = useState<Emotion>(machine.getState())
  const [bubble, setBubble] = useState<PetBubblePayload | null>(null)
  const [action, setAction] = useState<PoseName | null>(null)
  // 为什么记 press 起点：区分「拖动」与「点击」——startDragging 一旦触发，webview 收不到后续 click
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickPending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickIdx = useRef(0)

  useTodoAlarm(setBubble)

  const triggerAction = (pose: PoseName) => {
    // 动作期间锁定（第六轮验收要求）：正在播的动作必须完整放完，点击/拖拽都不得中途换动作
    if (actionTimer.current !== null) return
    setAction(pose)
    actionTimer.current = setTimeout(() => {
      actionTimer.current = null
      setAction(null)
    }, ACTION_MS[pose] ?? 4000)
  }

  useEffect(() => {
    const unsubs = [
      machine.subscribe(setEmotion),
      on<PetEmotionSignalPayload>(IPC.PET_EMOTION_SIGNAL, (p) => machine.signal(p.state, p.cause)),
      // 为什么宠物窗自己听 CHAT_DONE/CHAT_ERROR：「每轮 ≤1 切」的额度以对话轮结束为界，
      // 而 Chat 在面板窗口；harness event 对两窗广播，这里直接收事件即可，无需跨窗调用
      on(IPC.CHAT_DONE, () => machine.markTurn()),
      on(IPC.CHAT_ERROR, () => machine.markTurn()),
      on<PetBubblePayload>(IPC.PET_BUBBLE, setBubble),
    ]
    return () => {
      unsubs.forEach((u) => u())
      if (actionTimer.current !== null) clearTimeout(actionTimer.current)
      if (clickPending.current !== null) clearTimeout(clickPending.current)
    }
  }, [machine])

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    press.current = { x: e.screenX, y: e.screenY, dragging: false }
  }

  const onMouseMove = (e: MouseEvent) => {
    const p = press.current
    if (!p || p.dragging || e.buttons === 0) return
    // 契约偏差说明：契约写「mousedown 即 startDragging」，但那样 click 永远不触发、双击也吃不到；
    // 折中为位移 >4px 才开始整窗拖动，点按手感不变，拖动无感知差异。
    if (Math.abs(e.screenX - p.x) + Math.abs(e.screenY - p.y) > 4) {
      p.dragging = true
      triggerAction('wave') // 「点击拖拽动作」素材只在拖动时出现（第五轮契约）
      if (isTauri()) void getCurrentWindow().startDragging()
    }
  }

  const openMainPanel = (e: MouseEvent) => {
    const payload: PetPositionPayload = { position: { x: e.screenX, y: e.screenY } }
    send(IPC.PET_CLICKED, payload)
    if (isTauri()) void invoke('open_panel', { route: 'panel' })
    else window.location.hash = '#/panel' // 浏览器降级
  }

  // React 的 onClick + onDoubleClick 会分别触发两次 onClick + 一次 onDoubleClick；
  // 用 setTimeout 延后单击效果，dblclick 到达时取消，做到「单双击互斥」。
  const onSpriteClick = (_e: MouseEvent) => {
    if (press.current?.dragging) return // 拖动收尾的残留 click，不当点击处理
    if (clickPending.current !== null) clearTimeout(clickPending.current)
    clickPending.current = setTimeout(() => {
      clickPending.current = null
      if (actionTimer.current !== null) return // 动作播放中：忽略点击，也不推进轮换序号
      // 三个动作轮着来：每次单击换下一个，比固定一个有生气
      const pose = CLICK_ACTIONS[clickIdx.current % CLICK_ACTIONS.length]!
      clickIdx.current += 1
      triggerAction(pose)
    }, DOUBLE_CLICK_MS)
  }

  const onSpriteDoubleClick = (e: MouseEvent) => {
    if (clickPending.current !== null) {
      clearTimeout(clickPending.current)
      clickPending.current = null
    }
    openMainPanel(e)
  }

  // 缩放手柄：窗口边缘全透明看不见摸不准，宠物身上一拖又是移动窗口——给一个悬停可见的
  // 右下角手柄，按住即进入系统级窗口角拖拽缩放（等价拖普通窗口右下角）
  const onResizeGrip = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (isTauri()) void getCurrentWindow().startResizeDragging('SouthEast')
  }

  return (
    <div className="pet-window" onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
      {bubble && <Bubble bubble={bubble} onDismiss={() => setBubble(null)} />}
      <div className="sprite-hit" onClick={onSpriteClick} onDoubleClick={onSpriteDoubleClick}>
        {/* action 期间播对应动作视频；ACTION_MS 后回落情绪姿势（EMOTION_META.pose） */}
        <Sprite emotion={emotion} action={action} />
      </div>
      <div className="pet-resize" title="拖拽调整大小" onMouseDown={onResizeGrip}>
        🐾
      </div>
    </div>
  )
}

// pet/PetWindow.tsx —— 悬浮宠物窗口：PetVideoLayer + Bubble + 整窗拖动 + 动作交互（§4 悬浮宠物窗口行）
//
// 交互契约（第五轮真机验收后修订）：
//   · 单击（无拖动）→ 在 打哈欠/伸懒腰/舔爪子 三个动作间轮换播放，播完回落待机动作。
//   · 双击           → 打开主面板。
//   · 拖拽（>4px）   → 整窗随鼠标移动，播放 wave（点击拖拽动作素材只在拖动时出现）。
//   · 右下角猫爪手柄 → 系统级窗口角拖拽缩放。
// 另：待提醒（面板 Todo，localStorage 域）到点在此窗以气泡提示——轮询 30s，见 useTodoAlarm。

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { DEFAULT_CONFIG, IPC } from '@petsona/shared'
import type {
  BubbleActionPayload,
  Config,
  Emotion,
  PetBehaviorFrequency,
  PetBubblePayload,
  PetEmotionSignalPayload,
  PetPositionPayload,
} from '@petsona/shared'
import { isTauri, on, request, send } from '../lib/ipc'
import {
  dueInstances,
  ensureDayInstances,
  loadReminderState,
  markInstanceReminded,
  saveReminderState,
  todayDate,
} from '../lib/reminderStore'
import { PetVideoLayer } from '../PetVideoLayer'
import { DRAG_ANIMATION, IDLE_ANIMATION, PET_ACTION_SEQUENCE, type PetAnimation } from '../petAnimations'
import { getNextActionIndex, getRandomTailHoldMs } from '../petAnimationScheduler'
import { EmotionMachine } from './EmotionMachine'
import { Bubble } from './Bubble'
import { buildReminderBubble, completeFromBubbleAction, isReminderBubbleAction, snoozeFromBubbleAction } from './reminderAlarm'

// 双击窗口：间隔 <= 此值的两次单击视为双击开面板
const DOUBLE_CLICK_MS = 260
// 待提醒轮询：正式 reminder store（同源共享），这里每 30s 扫一次到点未通知项
const TODO_POLL_MS = 30_000

/** 待提醒到点 → 宠物气泡。MVP 先在壳侧闭环，后续迁 harness 后文案应走 reminders 兜底池。 */
function useTodoAlarm(fire: (bubble: PetBubblePayload) => void) {
  useEffect(() => {
    const check = () => {
      const nowIso = new Date().toISOString()
      let state = ensureDayInstances(loadReminderState(), todayDate(new Date(nowIso)), nowIso)
      const due = dueInstances(state, nowIso)[0]
      if (!due) {
        saveReminderState(state)
        return
      }
      state = markInstanceReminded(state, due.id, nowIso)
      saveReminderState(state)
      fire(buildReminderBubble(due))
    }
    check()
    const timer = setInterval(check, TODO_POLL_MS)
    return () => clearInterval(timer)
    // fire 由调用方保证稳定（setState），不进依赖免得反复重建定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function useReminderBubbleActions() {
  useEffect(() => on<BubbleActionPayload>(IPC.BUBBLE_ACTION, (payload) => {
    if (!isReminderBubbleAction(payload.actionId)) return
    const nowIso = new Date().toISOString()
    const current = loadReminderState()
    const next = payload.actionId.includes(':complete:')
      ? completeFromBubbleAction(current, payload.actionId, nowIso)
      : snoozeFromBubbleAction(current, payload.actionId, nowIso)
    saveReminderState(next)
  }), [])
}

export function PetWindow() {
  // 为什么放 ref 不放 state：状态机实例要跨渲染存活，重建会丢驻留计时与切换额度
  const machineRef = useRef<EmotionMachine | null>(null)
  if (machineRef.current === null) machineRef.current = new EmotionMachine()
  const machine = machineRef.current

  const [, setEmotion] = useState<Emotion>(machine.getState())
  const [bubble, setBubble] = useState<PetBubblePayload | null>(null)
  const [animation, setAnimation] = useState<PetAnimation>(IDLE_ANIMATION)
  const [actionIndex, setActionIndex] = useState(0)
  const [behaviorFrequency, setBehaviorFrequency] = useState<PetBehaviorFrequency>(DEFAULT_CONFIG.pet.behaviorFrequency)
  // 为什么记 press 起点：区分「拖动」与「点击」——startDragging 一旦触发，webview 收不到后续 click
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const animationRef = useRef<PetAnimation>(IDLE_ANIMATION)
  const tailHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickPending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPetMenuAt = useRef(0)

  useTodoAlarm(setBubble)
  useReminderBubbleActions()

  const switchAnimation = (nextAnimation: PetAnimation) => {
    animationRef.current = nextAnimation
    setAnimation(nextAnimation)
  }

  const clearTailHold = () => {
    if (tailHoldTimerRef.current === null) return
    clearTimeout(tailHoldTimerRef.current)
    tailHoldTimerRef.current = null
  }

  useEffect(() => {
    let alive = true
    void request<{ config: Config }>(IPC.CONFIG_GET, {})
      .then(({ config }) => {
        if (alive) setBehaviorFrequency(config.pet?.behaviorFrequency ?? DEFAULT_CONFIG.pet.behaviorFrequency)
      })
      .catch(() => undefined)

    const unsubConfig = on<{ config: Config }>(IPC.CONFIG_UPDATED, ({ config }) => {
      setBehaviorFrequency(config.pet?.behaviorFrequency ?? DEFAULT_CONFIG.pet.behaviorFrequency)
    })

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
      alive = false
      unsubConfig()
      unsubs.forEach((u) => u())
      clearTailHold()
      if (clickPending.current !== null) clearTimeout(clickPending.current)
    }
  }, [machine])

  const handleAnimationEnded = () => {
    if (animationRef.current.id === 'drag') return
    clearTailHold()
    tailHoldTimerRef.current = setTimeout(() => {
      if (animationRef.current.id === 'drag') return

      if (animationRef.current.id === 'idle') {
        setActionIndex((current) => {
          const nextAnimation = PET_ACTION_SEQUENCE[current % PET_ACTION_SEQUENCE.length]!
          switchAnimation(nextAnimation)
          return getNextActionIndex(current, PET_ACTION_SEQUENCE.length)
        })
        return
      }

      switchAnimation(IDLE_ANIMATION)
    }, getRandomTailHoldMs(behaviorFrequency))
  }

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
      clearTailHold()
      switchAnimation(DRAG_ANIMATION)
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
      if (animationRef.current.id === 'drag') return
      clearTailHold()
      // 三个动作轮着来：每次单击换下一个，比固定一个有生气
      setActionIndex((current) => {
        const nextAnimation = PET_ACTION_SEQUENCE[current % PET_ACTION_SEQUENCE.length]!
        switchAnimation(nextAnimation)
        return getNextActionIndex(current, PET_ACTION_SEQUENCE.length)
      })
    }, DOUBLE_CLICK_MS)
  }

  const onSpriteDoubleClick = (e: MouseEvent) => {
    if (clickPending.current !== null) {
      clearTimeout(clickPending.current)
      clickPending.current = null
    }
    openMainPanel(e)
  }

  const openPetMenu = () => {
    const now = Date.now()
    if (now - lastPetMenuAt.current < 250) return

    lastPetMenuAt.current = now
    if (isTauri()) void invoke('show_pet_menu').catch((error) => console.warn('[pet-menu] show failed', error))
  }

  const openPetContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openPetMenu()
  }

  const openPetMenuOnRightPointer = (e: PointerEvent) => {
    if (e.button !== 2) return

    e.preventDefault()
    e.stopPropagation()
    openPetMenu()
  }

  // 缩放手柄：窗口边缘全透明看不见摸不准，宠物身上一拖又是移动窗口——给一个悬停可见的
  // 右下角手柄，按住即进入系统级窗口角拖拽缩放（等价拖普通窗口右下角）
  const onResizeGrip = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (isTauri()) void getCurrentWindow().startResizeDragging('SouthEast')
  }

  const onMouseUp = () => {
    const wasDragging = press.current?.dragging ?? false
    press.current = null
    if (!wasDragging) return
    switchAnimation(IDLE_ANIMATION)
  }

  return (
    <main
      className="pet-stage pet-window"
      onPointerDownCapture={openPetMenuOnRightPointer}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={openPetContextMenu}
    >
      {bubble && <Bubble bubble={bubble} onDismiss={() => setBubble(null)} />}
      <div className="pet-hit-area sprite-hit" onClick={onSpriteClick} onDoubleClick={onSpriteDoubleClick}>
        <PetVideoLayer activeAnimation={animation} onEnded={handleAnimationEnded} />
      </div>
      <button className="pet-resize-handle pet-resize" type="button" title="调整大小" aria-label="调整宠物大小" onMouseDown={onResizeGrip}>
        <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path d="M6 4H3v3" />
          <path d="M3 4l5 5" />
          <path d="M12 14h3v-3" />
          <path d="M15 14l-5-5" />
        </svg>
      </button>
    </main>
  )
}

// pet/PetWindow.tsx —— 悬浮宠物窗口：Sprite + Bubble + 整窗拖动 + 单击 wave / 双击开面板（§4 悬浮宠物窗口行）
//
// 交互契约（第三轮真机验收后修订，替代前一版四选项菜单）：
//   · 单击（无拖动）→ 播放 wave 动作视频 WAVE_MS，一次性回落 sit；不弹菜单，不上移。
//   · 双击           → 打开主面板（走 open_panel('panel')）；同时不触发 wave 的开面板体验也自然。
//   · 拖拽（>4px）   → 整窗随鼠标移动，同时触发 wave 让宠物「有反应」。
// 契约文档 §4 原写「点击菜单」，第三轮改为「单击=动作、双击=开面板」——菜单会导致宠物 flex 上移
// 只剩下半身，且无 macOS 右键补位手段；用单/双击更直接。

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { IPC } from '@petsona/shared'
import type { Emotion, PetBubblePayload, PetEmotionSignalPayload, PetPositionPayload } from '@petsona/shared'
import { isTauri, on, send } from '../lib/ipc'
import { EmotionMachine } from './EmotionMachine'
import { Sprite } from './Sprite'
import { Bubble } from './Bubble'

// wave 动作视频约 3~4s，取 3500ms 让循环播 1~2 次自然收尾
const WAVE_MS = 3500
// 双击窗口：>1x 的单击间隔就归为「继续挑逗」，触发多次 wave；<= 视为双击开面板
const DOUBLE_CLICK_MS = 260

export function PetWindow() {
  // 为什么放 ref 不放 state：状态机实例要跨渲染存活，重建会丢驻留计时与切换额度
  const machineRef = useRef<EmotionMachine | null>(null)
  if (machineRef.current === null) machineRef.current = new EmotionMachine()
  const machine = machineRef.current

  const [emotion, setEmotion] = useState<Emotion>(machine.getState())
  const [bubble, setBubble] = useState<PetBubblePayload | null>(null)
  const [waving, setWaving] = useState(false)
  // 为什么记 press 起点：区分「拖动」与「点击」——startDragging 一旦触发，webview 收不到后续 click
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const waveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickPending = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerWave = () => {
    setWaving(true)
    if (waveTimer.current !== null) clearTimeout(waveTimer.current)
    waveTimer.current = setTimeout(() => {
      waveTimer.current = null
      setWaving(false)
    }, WAVE_MS)
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
      if (waveTimer.current !== null) clearTimeout(waveTimer.current)
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
      triggerWave() // 拖动本身也是「被挑逗」，接 wave 让宠物有反应（修①）
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
      triggerWave()
    }, DOUBLE_CLICK_MS)
  }

  const onSpriteDoubleClick = (e: MouseEvent) => {
    if (clickPending.current !== null) {
      clearTimeout(clickPending.current)
      clickPending.current = null
    }
    openMainPanel(e)
  }

  return (
    <div className="pet-window" onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
      {bubble && <Bubble bubble={bubble} onDismiss={() => setBubble(null)} />}
      <div className="sprite-hit" onClick={onSpriteClick} onDoubleClick={onSpriteDoubleClick}>
        {/* wave 期间切「举手打招呼」动作视频；WAVE_MS 后回落 sit（EMOTION_META.pose） */}
        <Sprite emotion={emotion} wave={waving} />
      </div>
    </div>
  )
}

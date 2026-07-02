// pet/PetWindow.tsx —— 悬浮宠物窗口：Sprite + Bubble + 整窗拖动 + 点击菜单（§4 悬浮宠物窗口行）

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

const MENU: Array<{ route: string; label: string }> = [
  { route: 'chat', label: '聊天' },
  { route: 'tasks', label: '任务' },
  { route: 'reminders', label: '提醒' },
  { route: 'settings', label: '设置' },
]

export function PetWindow() {
  // 为什么放 ref 不放 state：状态机实例要跨渲染存活，重建会丢驻留计时与切换额度
  const machineRef = useRef<EmotionMachine | null>(null)
  if (machineRef.current === null) machineRef.current = new EmotionMachine()
  const machine = machineRef.current

  const [emotion, setEmotion] = useState<Emotion>(machine.getState())
  const [bubble, setBubble] = useState<PetBubblePayload | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // 为什么记 press 起点：区分「拖动」与「点击」——startDragging 一旦触发，webview 收不到后续 click
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)

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
    return () => unsubs.forEach((u) => u())
  }, [machine])

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    press.current = { x: e.screenX, y: e.screenY, dragging: false }
  }

  const onMouseMove = (e: MouseEvent) => {
    const p = press.current
    if (!p || p.dragging || e.buttons === 0) return
    // 契约偏差说明：契约写「mousedown 即 startDragging」，但那样 click 永远不触发、菜单打不开；
    // 折中为位移 >4px 才开始整窗拖动，点按手感不变，拖动无感知差异。
    if (Math.abs(e.screenX - p.x) + Math.abs(e.screenY - p.y) > 4) {
      p.dragging = true
      if (isTauri()) void getCurrentWindow().startDragging()
    }
  }

  const onSpriteClick = () => {
    if (press.current?.dragging) return // 拖动收尾的残留 click，不当点击处理
    setMenuOpen((v) => !v)
  }

  const openPanel = (route: string, e: MouseEvent) => {
    setMenuOpen(false)
    const payload: PetPositionPayload = { position: { x: e.screenX, y: e.screenY } }
    send(IPC.PET_CLICKED, payload)
    if (isTauri()) void invoke('open_panel', { route })
    else window.location.hash = `#/panel/${route}` // 浏览器降级：同窗切到面板路由
  }

  return (
    <div className="pet-window" onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
      {bubble && <Bubble bubble={bubble} onDismiss={() => setBubble(null)} />}
      <div className="sprite-hit" onClick={onSpriteClick}>
        <Sprite emotion={emotion} />
      </div>
      {menuOpen && (
        <div className="pet-menu">
          {MENU.map((m) => (
            <button key={m.route} onClick={(e) => openPanel(m.route, e)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

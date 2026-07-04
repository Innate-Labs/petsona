// pet/Bubble.tsx —— 宠物气泡：渲染 PET_BUBBLE payload（§3.1 宠物状态类）

import { useEffect } from 'react'
import { IPC } from '@petsona/shared'
import type { BubbleActionPayload, PetBubblePayload } from '@petsona/shared'
import { request, send } from '../lib/ipc'

export function Bubble({ bubble, onDismiss }: { bubble: PetBubblePayload; onDismiss: () => void }) {
  useEffect(() => {
    // durationMs<=0 视为常驻（如审批气泡等人决策），不挂自动消失定时器
    if (bubble.durationMs > 0) {
      const t = setTimeout(onDismiss, bubble.durationMs)
      return () => clearTimeout(t)
    }
    return undefined
  }, [bubble, onDismiss])

  const acts = (bubble.actions ?? []).slice(0, 4) // 协议约束 ≤4，超出兜底裁剪

  const act = (actionId: string) => {
    const payload: BubbleActionPayload = { actionId }
    send(IPC.BUBBLE_ACTION, payload)
    // 为什么点击即关：决策已回传 harness，后续反馈（如审批结果）会以新气泡推回
    void request(IPC.BUBBLE_ACTION, payload).catch(() => {
      // 失败的人格化提示由 harness 兜底文案池负责，UI 不自造文案
    })
    onDismiss()
  }

  return (
    <div className={`bubble bubble--${bubble.kind}`}>
      <div className="bubble-text">{bubble.text}</div>
      {acts.length > 0 && (
        <div className="bubble-actions">
          {acts.map((a) => (
            <button key={a.actionId} onClick={() => act(a.actionId)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// pet/Sprite.tsx —— 六态占位 sprite（emoji + 色块），正式美术 M2 替换
// 为什么用 emoji：M1 只验证情绪链路（信号→状态机→渲染），不投入美术资源。

import type { Emotion } from '@petsona/shared'

const FACE: Record<Emotion, string> = {
  happy: '😺',
  angry: '😾',
  sad: '😿',
  anxious: '🙀',
  calm: '😸',
  unknown: '😼',
}

export function Sprite({ emotion }: { emotion: Emotion }) {
  return (
    <div className={`sprite sprite--${emotion}`} title={`情绪：${emotion}`}>
      <span className="sprite-face">{FACE[emotion]}</span>
    </div>
  )
}

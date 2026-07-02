// pet/Sprite.tsx —— 宠物形象渲染：情绪→语义姿势→当前角色资产（视频优先，图集兜底）
// 角色可插拔：本组件不 import 任何具体美术资产（lib/character.ts 是唯一出口）。
// 视频解码失败（如 WKWebView 不支持 webm/alpha）时 onError 自动降级图集，永不空窗。

import { useState } from 'react'
import type { Emotion } from '@petsona/shared'
import { EMOTION_META } from '../lib/emotion'
import { poseStyle, poseVideo } from '../lib/character'
import type { PoseName } from '../lib/character'

function PoseMedia({ pose }: { pose: PoseName }) {
  const [videoBroken, setVideoBroken] = useState(false)
  const src = poseVideo(pose)
  if (!src || videoBroken) return <div className="sprite-img" style={poseStyle(pose)} />
  return (
    <video
      className="sprite-video"
      // key 换源强制重载：同一 <video> 改 src 在部分 WebKit 上不重新起播
      key={src}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      onError={() => setVideoBroken(true)}
    />
  )
}

export function Sprite({ emotion, wave }: { emotion: Emotion; wave?: boolean }) {
  const meta = EMOTION_META[emotion]
  return (
    <div className="sprite" title={`情绪：${meta.label}`}>
      <div className="sprite-shadow" />
      <PoseMedia pose={wave ? 'wave' : meta.pose} />
      <span className="sprite-emotion">
        {meta.emoji} {meta.label}
      </span>
    </div>
  )
}

/** 无徽标版：首页 hero 等纯展示位（Figma 82:2041 无情绪角标） */
export function SpriteFigure({ emotion }: { emotion: Emotion }) {
  return (
    <div className="sprite">
      <div className="sprite-shadow" />
      <PoseMedia pose={EMOTION_META[emotion].pose} />
    </div>
  )
}

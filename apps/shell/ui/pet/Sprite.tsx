// pet/Sprite.tsx —— 宠物形象渲染：情绪→语义姿势→当前角色资产（视频优先，图集兜底）
// 角色可插拔：本组件不 import 任何具体美术资产（lib/character.ts 是唯一出口）。
//
// 防空窗定案（第五轮）：全部姿势视频**常驻同播**，切姿势只切透明度。
// 前两版的教训：a) key 重挂载换源 → WKWebView 重走加载/解码，必有透明空窗；
// b) 双缓冲若给垫底元素换 key，React 视为新元素照样重挂载，两路一起空窗；
// c)「起播超时判坏源」看门狗在冷启动被 tauri 协议的首载耗时误伤，永久回退旧图集。
// 常驻同播后视频元素从不重建，切换零加载零空窗；素材共 ~10MB 本地资产，硬解常驻可接受。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Emotion } from '@petsona/shared'
import { EMOTION_META } from '../lib/emotion'
import { CHARACTER, poseStyle, poseVideo } from '../lib/character'
import type { PoseName } from '../lib/character'

function PoseMedia({ pose }: { pose: PoseName }) {
  const [brokenSrcs, setBrokenSrcs] = useState<string[]>([])
  const refs = useRef(new Map<string, HTMLVideoElement>())
  // 去重后的全部姿势视频 URL（多个姿势可能回落到同一文件）；角色不变则终身稳定
  const allSrcs = useMemo(() => [...new Set(Object.values(CHARACTER.videos ?? {}))], [])

  const want = poseVideo(pose)
  const sitSrc = poseVideo('sit')
  const active =
    want && !brokenSrcs.includes(want) ? want : sitSrc && !brokenSrcs.includes(sitSrc) ? sitSrc : null

  useEffect(() => {
    // 动作从头播：切过去的瞬间把目标视频拨回第 0 帧（已解码，seek 即时）
    const el = active ? refs.current.get(active) : undefined
    if (!el) return
    try {
      el.currentTime = 0
    } catch {
      // 元数据未就绪时 seek 会抛，忽略——首播本来就是第 0 帧
    }
    void el.play().catch(() => {})
  }, [active])

  if (!active || allSrcs.length === 0) return <div className="sprite-img" style={poseStyle(pose)} />

  return (
    <>
      {allSrcs.map((s) => (
        <video
          key={s}
          ref={(el) => {
            if (el) refs.current.set(s, el)
            else refs.current.delete(s)
          }}
          className="sprite-video sprite-video--layer"
          style={{ opacity: s === active ? 1 : 0 }}
          src={s}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          onError={() => setBrokenSrcs((prev) => (prev.includes(s) ? prev : [...prev, s]))}
        />
      ))}
    </>
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

// pet/Sprite.tsx —— 宠物形象渲染：情绪→语义姿势→当前角色资产（视频优先，图集兜底）
// 角色可插拔：本组件不 import 任何具体美术资产（lib/character.ts 是唯一出口）。
//
// 防空窗双保险（第四轮真机验收修复「单击后宠物空白」）：
//   ① 双缓冲换源：新姿势视频没 fire onPlaying 之前，旧视频保持可见——WKWebView 对 <video>
//      key 重挂载后要重新走 加载→解码→起播，中间有几百毫秒透明空窗，快速切换时肉眼即「宠物消失」。
//   ② 起播看门狗：换源 1.5s 还没 playing 视为坏源（WKWebView 解码卡死常不 fire error），
//      按 pose→sit→图集 逐级回退，任何情况都有画面。

import { useEffect, useState } from 'react'
import type { Emotion } from '@petsona/shared'
import { EMOTION_META } from '../lib/emotion'
import { poseStyle, poseVideo } from '../lib/character'
import type { PoseName } from '../lib/character'

const PLAY_WATCHDOG_MS = 1500

function PoseMedia({ pose }: { pose: PoseName }) {
  const [brokenSrcs, setBrokenSrcs] = useState<string[]>([])
  // 最近一次确认起播成功的源：换源期间它就是「垫底画面」
  const [playingSrc, setPlayingSrc] = useState<string | null>(null)

  const markBroken = (src: string) =>
    setBrokenSrcs((prev) => (prev.includes(src) ? prev : [...prev, src]))

  const want = poseVideo(pose)
  const sitSrc = poseVideo('sit')
  const src =
    want && !brokenSrcs.includes(want) ? want : sitSrc && !brokenSrcs.includes(sitSrc) ? sitSrc : null

  useEffect(() => {
    if (!src || src === playingSrc) return
    const t = setTimeout(() => markBroken(src), PLAY_WATCHDOG_MS)
    return () => clearTimeout(t)
  }, [src, playingSrc])

  if (!src) return <div className="sprite-img" style={poseStyle(pose)} />

  const swapping = playingSrc !== null && playingSrc !== src
  return (
    <>
      {/* 换源期间垫底的旧源：新源起播后随下一次渲染卸载 */}
      {swapping && (
        <video
          className="sprite-video"
          key={`old-${playingSrc}`}
          src={playingSrc}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
        />
      )}
      <video
        className="sprite-video"
        // key 换源强制重载：同一 <video> 改 src 在部分 WebKit 上不重新起播
        key={src}
        src={src}
        // 新源未起播前叠在旧源上隐身等待，起播即接管
        style={swapping ? { position: 'absolute', inset: 0, opacity: 0 } : undefined}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        onPlaying={() => setPlayingSrc(src)}
        onLoadedData={() => setPlayingSrc(src)}
        onError={() => markBroken(src)}
      />
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

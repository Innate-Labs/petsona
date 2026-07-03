// pet/Sprite.tsx —— 宠物形象渲染：情绪→语义姿势→当前角色资产（视频优先，图集兜底）
// 角色可插拔：本组件不 import 任何具体美术资产（lib/character.ts 是唯一出口）。
//
// 防空窗定案（第五、六轮迭代）：全部姿势视频**常驻挂载**，元素终身不重建（重建即重加载
// 即空窗，WKWebView 铁律）。但只有 active 那路在解码播放，其余**暂停并停在第 0 帧**：
//   · 第五轮全员同播的两个真机症状——5 路 HEVC-alpha（每路双层解码）同跑导致卡顿；
//     隐藏层循环到一半被切出来先闪中段画面、异步 seek 又拉回 0 帧，肉眼即「动作重复播两遍」。
//   · 暂停停 0 帧后：切换瞬间直接显示动作第 0 帧 → play()，单次完整播放，无闪跳无卡顿。
// 仍不加「起播超时判坏源」看门狗：冷启动首载会被误伤（第四轮教训）。

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
  // 给异步回调（onLoadedMetadata）读当前 active 用，避免闭包吃到旧值
  const activeRef = useRef(active)
  activeRef.current = active

  const park = (el: HTMLVideoElement) => {
    el.pause()
    try {
      el.currentTime = 0 // 停回第 0 帧：下次被切换到时直接从动作开头亮相
    } catch {
      // 元数据未就绪时 seek 会抛；onLoadedMetadata 会再补一次
    }
  }

  useEffect(() => {
    for (const [s, el] of refs.current) {
      if (s === active) void el.play().catch(() => {})
      else park(el)
    }
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
          preload="auto"
          // autoPlay 只为触发加载管线；非 active 的在元数据就绪后立刻停回 0 帧
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          onLoadedMetadata={(e) => {
            if (s !== activeRef.current) park(e.currentTarget)
          }}
          onError={() => setBrokenSrcs((prev) => (prev.includes(s) ? prev : [...prev, s]))}
        />
      ))}
    </>
  )
}

/** action 传入时优先播该动作（单击轮换/拖拽 wave），否则跟随情绪姿势 */
export function Sprite({ emotion, action }: { emotion: Emotion; action?: PoseName | null }) {
  const meta = EMOTION_META[emotion]
  return (
    <div className="sprite" title={`情绪：${meta.label}`}>
      <div className="sprite-shadow" />
      <PoseMedia pose={action ?? meta.pose} />
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

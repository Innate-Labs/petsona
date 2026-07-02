// lib/emotion.ts —— 情绪 ↔ 展示映射：emoji 徽标文案 + 语义姿势名
// 姿势名→图集格位由 lib/character.ts 的当前角色决定；本文件不碰坐标，
// 换角色/换美术零改动。姿势语义映射是美术到位前的折中（SPEC-GAP：
// 正式六态动画按 v3.0 A.4 美术交付后，角色定义里直接给六态帧）。

import type { Emotion } from '@petsona/shared'
import type { PoseName } from './character'

export const EMOTION_META: Record<Emotion, { label: string; emoji: string; pose: PoseName }> = {
  happy: { label: '开心', emoji: '🥳', pose: 'cheer' },
  calm: { label: '平静', emoji: '😌', pose: 'sit' },
  unknown: { label: '未知', emoji: '❓', pose: 'tilt' },
  sad: { label: '伤心', emoji: '😿', pose: 'yawn' },
  angry: { label: '生气', emoji: '😾', pose: 'sleep' },
  anxious: { label: '焦虑', emoji: '😰', pose: 'stretch' },
}

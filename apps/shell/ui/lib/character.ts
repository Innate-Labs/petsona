// lib/character.ts —— 宠物角色唯一定义点（美术可插拔）
// 换角色只动本文件 + assets/characters/<id>/ 资产，业务组件一律经此取形象。
// 最终角色格式 = 逐动作透明底视频（action-<动作>.webm，如 action-sitting）；
// 图集（sheet）保留作为视频不可用时的兜底（macOS WKWebView 对 webm/alpha 支持
// 存疑，见 DESIGN.md「宠物角色」节——若真机不可解码由 Sprite 自动降级）。
// SPEC-GAP: 角色选择将来应入 Config（harness 持久化），M1 单角色常量即可。

import type { CSSProperties } from 'react'
import draftSheetUrl from '../assets/characters/draft-cat/sheet.png'
import draftAvatarUrl from '../assets/characters/draft-cat/avatar.png'
import sitVideoUrl from '../assets/characters/final-pet/sit.webm'

/** 语义姿势：业务/情绪层只认这些名字，不认资产形态（视频/图集格位） */
export type PoseName = 'sit' | 'wave' | 'sleep' | 'eat' | 'stretch' | 'cheer' | 'tilt' | 'yawn'

export type PetCharacter = {
  id: string
  /** 默认昵称/品种/自述（用户可在宠物数据页改，存档在 lib/local.ts） */
  defaultName: string
  defaultBreed: string
  defaultDesc: string
  avatar: string
  /** 逐姿势动作视频（透明底 webm/mov）；缺的姿势回落 sit 视频，再回落图集 */
  videos?: Partial<Record<PoseName, string>>
  /** 姿势图集兜底：cols×rows 网格 + 语义姿势→格位 */
  sheet: { url: string; cols: number; rows: number }
  poses: Partial<Record<PoseName, { col: number; row: number }>>
}

const DRAFT_SHEET = {
  sheet: { url: draftSheetUrl, cols: 4, rows: 2 },
  poses: {
    sit: { col: 0, row: 0 },
    wave: { col: 1, row: 0 },
    sleep: { col: 2, row: 0 },
    eat: { col: 3, row: 0 },
    stretch: { col: 0, row: 1 },
    cheer: { col: 1, row: 1 },
    tilt: { col: 2, row: 1 },
    yawn: { col: 3, row: 1 },
  },
} as const

/** Figma 草稿猫（纯图集，无视频）——最终角色资产齐前的兜底外观 */
const DRAFT_CAT: PetCharacter = {
  id: 'draft-cat',
  defaultName: '糯米',
  defaultBreed: '布偶猫',
  defaultDesc:
    '我家布偶叫糯米，长得看着特别温柔，毛白白长长的，看着仙气十足。其实性格软乎乎没脾气，谁抱都不反抗，随便撸毛也不会伸爪子。',
  avatar: draftAvatarUrl,
  ...DRAFT_SHEET,
}

/** 最终定稿角色（视频动作，占位接入中）：目前仅 action-sitting 到货，
    其余动作视频与专属头像/人设待用户投喂后补齐本定义。 */
const FINAL_PET: PetCharacter = {
  ...DRAFT_CAT,
  id: 'final-pet',
  videos: {
    sit: sitVideoUrl,
  },
}

/** 当前生效角色：定稿资产齐了就固定为 FINAL_PET */
export const CHARACTER: PetCharacter = FINAL_PET

/** 姿势 → 动作视频 URL；缺姿势回落 sit，无视频返回 null（走图集） */
export function poseVideo(pose: PoseName): string | null {
  const v = CHARACTER.videos
  return v?.[pose] ?? v?.sit ?? null
}

/** 姿势 → 图集 background 样式（缺姿势回落 sit，保证永不裂图） */
export function poseStyle(pose: PoseName): CSSProperties {
  const { sheet, poses } = CHARACTER
  const cell = poses[pose] ?? poses.sit ?? { col: 0, row: 0 }
  return {
    backgroundImage: `url(${sheet.url})`,
    backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `${sheet.cols > 1 ? (cell.col * 100) / (sheet.cols - 1) : 0}% ${
      sheet.rows > 1 ? (cell.row * 100) / (sheet.rows - 1) : 0
    }%`,
  }
}

// lib/local.ts —— 面板本地暂存（宠物档案/待办/提醒开关记忆）
// SPEC-GAP: 宠物档案与待办在 v3.0 无 harness 数据域，M1 暂存 localStorage；
// M2 应迁 $DATA/<userId>/（缝④）并走 MemoryStore——届时本文件仅剩读写桥接。

export type PetProfile = {
  name: string
  petNo: string
  species: string
  personality: string
  breed: string
  age: string
  weight: string
  deworm: string
  vaccine: string
  desc: string
  /** 陪伴起始日，ISO 日期；「已陪伴你 N 天」由此推算 */
  since: string
}

export type TodoItem = { id: string; text: string; time: string; done: boolean; repeat?: boolean }

const K_PROFILE = 'petsona.profile'
const K_TODOS = 'petsona.todos'
const K_PREFS = 'petsona.uiprefs'

// 默认值取 Figma 稿演示数据；默认昵称跟当前角色走（lib/character.ts）
import { CHARACTER } from './character'

const DEFAULT_PROFILE: PetProfile = {
  name: CHARACTER.defaultName,
  petNo: '12134451',
  species: '小猫',
  personality: '温柔',
  breed: CHARACTER.defaultBreed,
  age: '2岁3月',
  weight: '7.8千克',
  deworm: '2026/6/28',
  vaccine: '2026/5/22',
  desc: CHARACTER.defaultDesc,
  since: '2026-03-06',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

export const loadProfile = (): PetProfile => read(K_PROFILE, DEFAULT_PROFILE)

export const saveProfile = (p: PetProfile): void => localStorage.setItem(K_PROFILE, JSON.stringify(p))

export const companionDays = (p: PetProfile): number =>
  Math.max(1, Math.floor((Date.now() - new Date(p.since).getTime()) / 86_400_000))

export function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(K_TODOS)
    return raw ? (JSON.parse(raw) as TodoItem[]) : []
  } catch {
    return []
  }
}

export const saveTodos = (t: TodoItem[]): void => localStorage.setItem(K_TODOS, JSON.stringify(t))

/** UI 偏好：提醒卡开关态（协议无 REMINDER_STATE_GET，SPEC-GAP）+ 行为频次演示值 */
export type UiPrefs = { reminders: Record<string, boolean>; motionFreq: string }

export const loadPrefs = (): UiPrefs => read(K_PREFS, { reminders: {}, motionFreq: '缓慢' })

export const savePrefs = (p: UiPrefs): void => localStorage.setItem(K_PREFS, JSON.stringify(p))

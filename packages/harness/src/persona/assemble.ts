// s10 系统提示组装：段序固定 PERSONA-CORE → COMPANION_RULES → SKILL_INDEX → MEMORY_INDEX → EMOTION_STATE → TIME_SCENE
// 稳定段在前、易变段在后，保护 API prompt cache；确定性缓存 key = 各段内容 hash（§5）

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Emotion } from '@petsona/shared'
import type { DataPaths } from '../paths.js'

// 轻工具约定 + 派发纪律（COMPANION_RULES 段，M1 内置常量）
const COMPANION_RULES = `<companion-rules>
你有 8 个轻工具：recall_memory / remember / set_emotion / read_context / schedule_reminder / dispatch_task / check_task / load_skill。
- 想不起旧事时先 recall_memory，别硬编。
- 用户透露长期偏好/事实时用 remember 记下。
- 心情明显变化时 set_emotion（一轮最多一次）。
- 需要动文件、跑命令等重活：只能 dispatch_task 派发，你自己没有重工具；探索用 explore，写改用 worker。
- 派发后用自己的话告诉用户「去干活啦」，结果回来后如实播报，didWhat 之外不编造。
</companion-rules>`

export type PersonaSegments = {
  personaCore: string
  companionRules: string
  skillIndex: string
  memoryIndex: string
  emotionState: string
  timeScene: string
}

export function buildSegments(paths: DataPaths, emotion: Emotion): PersonaSegments {
  return {
    personaCore: readIfExists(join(paths.personas, 'PERSONA.md')) || '你是桌面宠物「宠格」，说话简短温暖。',
    companionRules: COMPANION_RULES,
    skillIndex: wrapIfPresent('skill-index', readIfExists(join(paths.skills, 'INDEX.md'))),
    memoryIndex: wrapIfPresent('memory-index', readIfExists(paths.memoryIndex)),
    emotionState: `<emotion-state>当前情绪：${emotion}</emotion-state>`,
    timeScene: `<time-scene>${timeScene()}</time-scene>`,
  }
}

export function assembleSystem(seg: PersonaSegments): { system: string; cacheKey: string } {
  const ordered = [seg.personaCore, seg.companionRules, seg.skillIndex, seg.memoryIndex, seg.emotionState, seg.timeScene]
  const system = ordered.filter(Boolean).join('\n\n')
  const cacheKey = ordered.map((s) => createHash('sha256').update(s).digest('hex').slice(0, 8)).join('-')
  return { system, cacheKey }
}

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
}

function wrapIfPresent(tag: string, content: string): string {
  return content ? `<${tag}>\n${content}\n</${tag}>` : ''
}

function timeScene(): string {
  const h = new Date().getHours()
  const scene = h < 6 ? '深夜' : h < 9 ? '清晨' : h < 12 ? '上午' : h < 14 ? '午间' : h < 18 ? '下午' : h < 22 ? '晚上' : '深夜'
  return `现在是${scene}（${new Date().toLocaleString('zh-CN')}）`
}

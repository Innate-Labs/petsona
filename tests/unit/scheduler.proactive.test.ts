// P-PROACTIVE-IDLE（提示词体系 §5.2）cheap 档决策 + p02 语义去重（失败视为重复）
import { describe, expect, it } from 'vitest'
import type { LlmChatResponse } from '@petsona/shared'
import { decideProactive, isSimilarToRecent } from '../../packages/harness/src/persona/proactive.js'

const gw = (text: string | Error) => ({
  chatOnce: async (): Promise<LlmChatResponse> => {
    if (text instanceof Error) throw text
    return { content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { in: 1, out: 1 } }
  },
})
const input = { idleMinutes: 30, frequency: 'mid' as const, personaCore: '你是桌宠「宠格」。' }

describe('decideProactive', () => {
  it('should_speak=true 返回文案', async () => {
    const out = await decideProactive(gw('{"should_speak":true,"bubble_text":"下午茶时间到啦喵"}'), input)
    expect(out).toBe('下午茶时间到啦喵')
  })
  it('should_speak=false → null', async () => {
    expect(await decideProactive(gw('{"should_speak":false}'), input)).toBeNull()
  })
  it('JSON 混在文本里也能解析', async () => {
    const out = await decideProactive(gw('好的：{"should_speak":true,"bubble_text":"嗨"}'), input)
    expect(out).toBe('嗨')
  })
  it('解析失败 / 空文案 / 调用异常 → null', async () => {
    expect(await decideProactive(gw('乱码'), input)).toBeNull()
    expect(await decideProactive(gw('{"should_speak":true,"bubble_text":"  "}'), input)).toBeNull()
    expect(await decideProactive(gw(new Error('boom')), input)).toBeNull()
  })
})

describe('isSimilarToRecent', () => {
  it('历史为空 → false（不用调 LLM）', async () => {
    expect(await isSimilarToRecent(gw(new Error('不该被调')), '嗨', [])).toBe(false)
  })
  it('模型判相似 → true / 不相似 → false', async () => {
    expect(await isSimilarToRecent(gw('{"similar":true}'), '嗨', ['嗨呀'])).toBe(true)
    expect(await isSimilarToRecent(gw('{"similar":false}'), '嗨', ['去喝水'])).toBe(false)
  })
  it('判定失败视为重复（p02 fail-closed）', async () => {
    expect(await isSimilarToRecent(gw('乱码'), '嗨', ['嗨呀'])).toBe(true)
    expect(await isSimilarToRecent(gw(new Error('boom')), '嗨', ['嗨呀'])).toBe(true)
  })
})

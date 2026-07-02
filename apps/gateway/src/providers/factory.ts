// createProvider（v2.1 §2.1.1：name 从 env 读，源码不 hardcode 选型）
// 规则：LLM_PROVIDER=mock|openai|anthropic + tier 选档；缺省/缺 key 一律回落 mock 并 console.warn。

import type { LlmTier } from '@petsona/shared'
import { envStr } from '../env.js'
import type { LLMProvider } from './provider.js'
import { MockLLMProvider } from './mock.js'
import { OpenAICompatProvider } from './openai_compat.js'
import { AnthropicProvider } from './anthropic.js'

// 为什么按「provider 名 + tier」缓存实例：mock 的回复轮换游标需要跨请求保持；
// 真实 provider 复用实例避免每请求重复构造。env 变更（测试场景）用 key 区分即可失效。
const cache = new Map<string, LLMProvider>()

export function createProvider(tier: LlmTier): LLMProvider {
  const name = envStr('LLM_PROVIDER', 'mock').toLowerCase()
  const key = cacheKey(name, tier)
  const hit = cache.get(key)
  if (hit) return hit

  let provider: LLMProvider
  try {
    provider = build(name, tier)
  } catch (e) {
    console.warn(`[gateway] provider "${name}"(${tier}) 构造失败，回落 mock：${e instanceof Error ? e.message : e}`)
    provider = getMock()
  }
  cache.set(key, provider)
  return provider
}

function build(name: string, tier: LlmTier): LLMProvider {
  switch (name) {
    case 'openai': {
      // 两档 env：LLM_MAIN_* / LLM_CHEAP_*；cheap 未配时降级用主档（v2.1 能力契约 SHOULD 的降级路径）
      const p = tier === 'cheap' && process.env.LLM_CHEAP_API_KEY ? 'LLM_CHEAP' : 'LLM_MAIN'
      return new OpenAICompatProvider({
        baseUrl: envStr(`${p}_BASE_URL`, 'https://api.deepseek.com'),
        apiKey: envStr(`${p}_API_KEY`, ''),
        model: envStr(`${p}_MODEL`, ''),
        label: `${p}(${tier})`,
      })
    }
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: envStr('ANTHROPIC_API_KEY', ''),
        // SPEC-GAP: 规格未给 Anthropic 分档模型 env 名，按 ANTHROPIC_MAIN_MODEL/ANTHROPIC_CHEAP_MODEL；cheap 缺省回主档
        model: tier === 'cheap'
          ? envStr('ANTHROPIC_CHEAP_MODEL', envStr('ANTHROPIC_MAIN_MODEL', ''))
          : envStr('ANTHROPIC_MAIN_MODEL', ''),
        baseUrl: envStr('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
      })
    case 'mock':
      return getMock()
    default:
      console.warn(`[gateway] 未知 LLM_PROVIDER="${name}"，回落 mock`)
      return getMock()
  }
}

// mock 全局单例：main/cheap 共用一个，保证回复轮换在测试里可预期
function getMock(): LLMProvider {
  const hit = cache.get('mock')
  if (hit) return hit
  const m = new MockLLMProvider()
  cache.set('mock', m)
  return m
}

function cacheKey(name: string, tier: LlmTier): string {
  if (name === 'mock') return 'mock'
  // 把关键 env 掺进 key：测试中途改 env（如换 key）能拿到新实例
  return [name, tier, process.env.LLM_MAIN_API_KEY, process.env.LLM_CHEAP_API_KEY, process.env.ANTHROPIC_API_KEY].join('|')
}

export function resetProviderCache(): void {
  cache.clear()
}

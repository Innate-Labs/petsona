// §2.3 Config（config.json）

export type ProactiveFrequency = 'high' | 'mid' | 'low' | 'off'
export type PetBehaviorFrequency = 'quiet' | 'normal' | 'active'

export type Config = {
  gatewayUrl: string
  pet: {
    behaviorFrequency: PetBehaviorFrequency
  }
  llmDebug: {
    baseUrl: string
    model: string
  }
  reminders: {
    pomodoro: { focusMin: number; restMin: number }
    waterMin: number
    standMin: number
  }
  proactive: {
    frequency: ProactiveFrequency          // p02：≥15/45/120min | 禁用
    quietHours: [string, string]           // "22:00","09:00"
    fullscreenMute: boolean                // 默认 true
  }
  taskBudget: {
    maxToolCalls: number
    maxTokens: number
    wallclockMin: number
    approvalWaitMin: number
  }
  scopes: string[]            // 用户授权目录白名单（安全书签持久化）
}

export const DEFAULT_CONFIG: Config = {
  gatewayUrl: 'http://127.0.0.1:8787',   // SPEC-GAP: 规格未给默认网关地址，dev 默认本机端口
  pet: {
    behaviorFrequency: 'normal',
  },
  llmDebug: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  reminders: {
    pomodoro: { focusMin: 25, restMin: 5 },   // SPEC-GAP: 规格未给番茄钟默认值，取行业惯例 25/5
    waterMin: 60,
    standMin: 45,
  },
  proactive: {
    frequency: 'mid',
    quietHours: ['22:00', '09:00'],
    fullscreenMute: true,
  },
  taskBudget: { maxToolCalls: 40, maxTokens: 50_000, wallclockMin: 10, approvalWaitMin: 10 },  // 默认 40/50_000/10/10
  scopes: ['~/Downloads', '~/Desktop'],
}

// p02 主动频次阈值（分钟）
export const PROACTIVE_MIN_GAP: Record<Exclude<ProactiveFrequency, 'off'>, number> = {
  high: 15,
  mid: 45,
  low: 120,
}

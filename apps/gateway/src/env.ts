// 环境变量集中读取（v3.0 §2.4 增量 + 继承 v2.1 §2.4）
// 为什么用函数而非模块级常量：测试需要在运行中改 process.env（限流阈值、预算等），
// 惰性读取保证每次请求拿到最新值，也避免 import 顺序耦合。

export function envStr(name: string, def: string): string {
  const v = process.env[name]
  return v !== undefined && v !== '' ? v : def
}

export function envInt(name: string, def: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export function envFloat(name: string, def: number): number {
  return envInt(name, def)   // Number() 本身支持小数，复用即可
}

export const env = {
  port: () => envInt('PORT', 8787),
  corsOrigin: () => envStr('CORS_ORIGIN', 'tauri://localhost'),
  desktopMinVersion: () => envStr('DESKTOP_MIN_VERSION', '3.0.0'),
  isProd: () => envStr('NODE_ENV', 'development') === 'production',

  // —— LLM（任务指定 LLM_PROVIDER 单开关 + tier 分档；SPEC-GAP: v2.1 用 LLM_MAIN_PROVIDER/LLM_CHEAP_PROVIDER 分档命名）——
  llmProvider: () => envStr('LLM_PROVIDER', 'mock'),
  llmTimeoutMs: () => envInt('LLM_TIMEOUT_MS', 60_000),   // SPEC-GAP: 规格未给上游超时，行业默认 60s

  // —— Auth / JWT（v2.1 §3.3；桌面差异 aud=petsona-desktop）——
  jwtAccessSecret: () => envStr('JWT_ACCESS_SECRET', envStr('JWT_SECRET', 'dev-secret')),
  jwtRefreshSecret: () => envStr('JWT_REFRESH_SECRET', envStr('JWT_SECRET', 'dev-secret')),
  jwtAccessTtl: () => envStr('JWT_ACCESS_TTL', '15m'),
  jwtRefreshTtl: () => envStr('JWT_REFRESH_TTL', '30d'),
  jwtIssuer: () => envStr('JWT_ISSUER', 'petsona'),
  jwtAudience: () => envStr('JWT_AUDIENCE', 'petsona-desktop'),

  // —— 验证码（v2.1 §2.4 邮箱验证码）——
  emailCodeTtl: () => envInt('EMAIL_CODE_TTL', 600),
  emailCodeLength: () => envInt('EMAIL_CODE_LENGTH', 6),
  devFixedCode: () => envStr('DEV_FIXED_CODE', '888888'),
  authStoreFile: () => process.env.AUTH_STORE_FILE ?? '',

  // —— 限流 / 预算（v2.1 §2.4；BUDGET_DAILY_USD 桌面 M1 按任务指定默认 5，v2.1 原文默认 50）——
  rateChatPerMin: () => envInt('RATE_LIMIT_CHAT_PER_MIN', 20),
  rateChatPerDay: () => envInt('RATE_LIMIT_CHAT_PER_DAY', 500),
  rateAuthPerHour: () => envInt('RATE_LIMIT_AUTH_PER_HOUR', 5),
  budgetDailyUsd: () => envFloat('BUDGET_DAILY_USD', 5),
  taskMaxTokens: () => envInt('TASK_MAX_TOKENS', 50_000),
  // SPEC-GAP: 规格未给 token 单价，按行业均价估算（USD / 百万 token），仅用于预算熔断
  priceInPerMTok: () => envFloat('LLM_PRICE_IN_USD_PER_MTOK', 2),
  priceOutPerMTok: () => envFloat('LLM_PRICE_OUT_USD_PER_MTOK', 8),
}

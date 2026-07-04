// §3.5 权限规则与审批

export type PermissionLevel = 'L0' | 'L1' | 'L2' | 'L3'    // 自动 / 通知 / 确认 / 禁止（语义见架构文档 §5.1）

export type PermissionRule = {
  id: string
  tool: string                                 // 工具名或 'shell'
  match?: { pathGlob?: string; cmdRegex?: string }
  level: PermissionLevel
  source: 'builtin' | 'user'                   // builtin 的 L3 不可被 user 规则降级
  ttl?: 'session' | 'forever'
}

// 内置 L3（硬编码，不进配置文件）：builtin L3 短路一切
export const BUILTIN_L3_RULES: readonly PermissionRule[] = [
  { id: 'builtin-sudo', tool: 'shell', match: { cmdRegex: '(^|\\s|;|&|\\|)sudo(\\s|$)' }, level: 'L3', source: 'builtin' },
  { id: 'builtin-rm', tool: 'shell', match: { cmdRegex: '(^|\\s|;|&|\\|)rm(\\s|$)' }, level: 'L3', source: 'builtin' }, // 任何形式的直删
  { id: 'builtin-keychain', tool: 'shell', match: { cmdRegex: 'security\\s+(find|dump)|Keychain' }, level: 'L3', source: 'builtin' },
  { id: 'builtin-ssh-read', tool: 'fs_read', match: { pathGlob: '~/.ssh/**' }, level: 'L3', source: 'builtin' },
  { id: 'builtin-browser-cred', tool: 'fs_read', match: { pathGlob: '~/Library/**/{Cookies,Login Data,key4.db,logins.json}*' }, level: 'L3', source: 'builtin' },
  { id: 'builtin-pay-scheme', tool: 'shell', match: { cmdRegex: 'open\\s+"?(alipay|weixin|paypal)://' }, level: 'L3', source: 'builtin' },
  { id: 'builtin-send-as-user', tool: 'applescript', match: { cmdRegex: '(send|outgoing message|mail)' }, level: 'L3', source: 'builtin' },
] as const

// 审计行（logs/audit.jsonl）
export type AuditEntry = {
  t: number
  taskId?: string
  tool: string
  inputDigest: string        // input 摘要，不含正文
  level: PermissionLevel
  ruleId?: string
  decision: 'allow' | 'notify' | 'confirm' | 'deny'
}

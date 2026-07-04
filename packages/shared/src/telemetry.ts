// §9 埋点（框架继承 v2.1 §9：DeviceID/UserID、不采正文、域名级脱敏）

export const TRACK = {
  // —— 沿用 v2.1 ——
  安装: 1001,
  注册: 1003,
  登录: 1004,
  登出: 1005,
  对话_发起: 1101,
  对话_完成: 1102,
  提醒_设置: 1301,
  提醒_触发: 1302,
  反馈: 1401,
  AI_失败: 1501,
  兜底_触发: 1502,
  // —— 替换/新增（桌面）——
  桌宠_启动: 1002,          // App 冷启动完成：Version、启动耗时
  任务_派发: 1601,          // dispatch_task：agentType、skill、scopeDirs 数
  任务_完成: 1602,          // result 事件：status、toolCalls、tokens、durationSec
  审批_请求: 1603,          // awaiting_approval：opCounts、risk
  审批_决策: 1604,          // APPROVAL_DECISION：decision、excluded 数、决策耗时
  撤销_触发: 1605,          // UNDO_REQUEST：restored、failed 数
  主动气泡_展示: 1701,      // proactive 气泡：triggerType、idleMinutes
  主动气泡_互动: 1702,      // 点击/关闭：action
  心跳_被频控拦截: 1703,    // p02 拦截：拦截原因（gap/quiet/fullscreen/dupe）
  记忆_提取: 1801,          // extract 产出 >0：type 分布、条数
  Dream_完成: 1802,         // 夜间整理：合并数、淘汰数、耗时
} as const

export type TrackEventId = (typeof TRACK)[keyof typeof TRACK]

export type TrackEvent = {
  eventId: TrackEventId | number
  props: Record<string, unknown>
  t: number
  deviceId: string
  userId?: string
}

// 批量上报（SPEC-GAP: 规格未给批量阈值/间隔，按行业默认 20 条或 30s 先到先发）
export const TRACK_BATCH_SIZE = 20
export const TRACK_FLUSH_MS = 30_000

// lib/chatSeed.ts —— 首页快捷输入框与对话记录页之间的一次性种子
// 为什么用 sessionStorage 而不是 hash 参数：原文可能含标点/换行，hash 编码可用但每次跳转都要 URL-safe 处理；
// sessionStorage 简单直接，且 Chat.tsx 挂载时 pop 一次立刻清空，不会残留跨会话。

export const CHAT_SEED_KEY = 'petsona.chat.seed'

/** Chat.tsx 挂载时调用一次：取出并清除首页塞进来的初始消息（无 seed → null） */
export function popChatSeed(): string | null {
  try {
    const v = window.sessionStorage.getItem(CHAT_SEED_KEY)
    if (v === null) return null
    window.sessionStorage.removeItem(CHAT_SEED_KEY)
    return v
  } catch {
    return null
  }
}

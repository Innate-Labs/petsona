import avatarIcon from './assets/chat-icons/头像.png';
import type { ChatMsg } from './lib/useChat';

export const OWNER_MOODS = ['🥳 开心', '😡 生气', '💔 伤心', '🌑 未知', '🙁 焦虑', '🪷 平静'] as const;

export const HOME_SHORTCUTS = [
  { icon: '🔎', label: '帮我查资料', prompt: '帮我查资料' },
  { icon: '📁', label: '帮我找文件', prompt: '帮我找文件' },
  { icon: '🧹', label: '整理桌面', prompt: '整理桌面' },
  { icon: '🗑️', label: '清理废纸篓', prompt: '清理废纸篓' },
  { icon: '⏰', label: '新建提醒', prompt: '新建提醒' },
  { icon: '🍅', label: '开始番茄钟', prompt: '开始番茄钟' }
] as const;

export type PanelTab = 'home' | 'petData' | 'reminders' | 'settings' | 'history';

export type HistoryConversation = {
  id: string;
  title: string;
  timeLabel: string;
  group: '今天' | '昨天' | '本周' | '本月' | '更早';
  messages: ChatMsg[];
};

export type PanelState = {
  pet: {
    name: string;
    avatar: string;
    age: string;
    weight: string;
    companionDays: number;
    ownerMood: (typeof OWNER_MOODS)[number];
  };
  stats: {
    water: number;
    stand: number;
    pomodoro: number;
    todo: number;
  };
  history: HistoryConversation[];
};

export function getConversationTitle(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 16 ? `${trimmed.slice(0, 16)}...` : trimmed || 'Hi 主人';
}

export const CHAT_HISTORY_SESSION_GAP_MS = 30 * 60_000;

export function turnsToHistoryConversations(msgs: ChatMsg[]): HistoryConversation[] {
  const sessions: HistoryConversation[] = [];
  let current: HistoryConversation | null = null;
  let currentLastTime = 0;
  const byConversationId = new Map<string, HistoryConversation>();

  for (let index = 0; index < msgs.length; index += 1) {
    const message = msgs[index];
    if (!message) continue;
    const t = message.t ?? (currentLastTime || Date.now());
    if (message.conversationId) {
      const existing = byConversationId.get(message.conversationId);
      current = existing ?? {
        id: message.conversationId,
        title: getConversationTitle(message.role === 'user' ? message.text : ''),
        timeLabel: formatHistoryTime(t),
        group: classifyHistoryGroup(t),
        messages: []
      };
      if (!existing) {
        byConversationId.set(message.conversationId, current);
        sessions.push(current);
      }
    } else {
      const shouldStartSession =
      !current ||
      (message.role === 'user' && current.messages.length > 0 && t - currentLastTime > CHAT_HISTORY_SESSION_GAP_MS);

      if (shouldStartSession) {
        current = {
          id: `session-${message.key}`,
          title: getConversationTitle(message.text),
          timeLabel: formatHistoryTime(t),
          group: classifyHistoryGroup(t),
          messages: []
        };
        sessions.push(current);
      }
    }

    if (!current) continue;
    if ((!current.title || current.title === 'Hi 主人') && message.role === 'user') {
      current.title = getConversationTitle(message.text);
    }
    current.messages.push(message);
    currentLastTime = Math.max(currentLastTime, t);
    current.timeLabel = formatHistoryTime(currentLastTime);
    current.group = classifyHistoryGroup(currentLastTime);
  }

  return sessions.reverse();
}

export function classifyHistoryGroup(t: number): HistoryConversation['group'] {
  const now = new Date();
  const date = new Date(t);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86_400_000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return '本周';
  if (now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth()) return '本月';
  return '更早';
}

export function formatHistoryTime(t: number): string {
  const date = new Date(t);
  const group = classifyHistoryGroup(t);
  if (group === '今天') {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (group === '昨天') return '昨天';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createDefaultPanelState(): PanelState {
  return {
    pet: {
      name: '糯米',
      avatar: avatarIcon,
      age: '1年3月',
      weight: '7kg',
      companionDays: 1,
      ownerMood: '🌑 未知'
    },
    stats: {
      water: 0,
      stand: 0,
      pomodoro: 0,
      todo: 0
    },
    history: []
  };
}

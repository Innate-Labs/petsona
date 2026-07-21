import avatarIcon from './assets/chat-icons/头像.png';
import { PROACTIVE_CONVERSATION_ID, type ChatConversationSummary } from '@petsona/shared';

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
  messageCount: number;
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

// 历史列表数据源改为后端 recentConversations（真实 conversationId）——
// 旧版在前端按 30 分钟间隔猜分组并伪造 `session-<key>` id，从那种会话续聊时
// 后端按伪 id 查不到任何历史 → 上下文彻底断裂（「没有上下文窗口」的直接原因）。
export function conversationsToHistory(list: ChatConversationSummary[]): HistoryConversation[] {
  return list
    .filter((c) => c.id !== PROACTIVE_CONVERSATION_ID)
    .map((c) => ({
      id: c.id,
      title: getConversationTitle(c.title),
      timeLabel: formatHistoryTime(c.updatedAt),
      group: classifyHistoryGroup(c.updatedAt),
      messageCount: c.messageCount
    }));
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

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

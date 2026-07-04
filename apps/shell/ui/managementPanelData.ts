import avatarIcon from './assets/chat-icons/头像.png';

export const OWNER_MOODS = ['🥳 开心', '😡 生气', '💔 伤心', '🌑 未知', '🙁 焦虑', '🪷 平静'] as const;

export const RECENT_HISTORY_LIMIT = 20;

export const HOME_SHORTCUTS = [
  { icon: '🔎', label: '帮我查资料', prompt: '帮我查资料' },
  { icon: '📁', label: '帮我找文件', prompt: '帮我找文件' },
  { icon: '🧹', label: '整理桌面', prompt: '整理桌面' },
  { icon: '🗑️', label: '清理废纸篓', prompt: '清理废纸篓' },
  { icon: '⏰', label: '新建提醒', prompt: '新建提醒' },
  { icon: '🍅', label: '开始番茄钟', prompt: '开始番茄钟' }
] as const;

export type PanelTab = 'home' | 'petData' | 'reminders' | 'settings' | 'history';

export type PanelMessage = {
  id: number;
  speaker: 'user' | 'pet';
  text: string;
};

export type HistoryConversation = {
  id: string;
  title: string;
  timeLabel: string;
  group: '今天' | '昨天' | '本周' | '本月' | '更早';
  messages: PanelMessage[];
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

const HISTORY_SEEDS = [
  ['手机版对话', '10:42', '今天'],
  ['驼峰命名', '09:18', '今天'],
  ['剧集信息核查', '昨天', '昨天'],
  ['Excel 标色不同参数', '昨天', '昨天'],
  ['写prompt常见误区', '周二', '本周'],
  ['提取字段', '周二', '本周'],
  ['重复话语', '周一', '本周'],
  ['WebM是什么', '06-29', '本月'],
  ['江西考生高考志愿填报建议', '06-28', '本月'],
  ['给姐夫孩子志愿填报的建议', '06-27', '本月'],
  ['视频抠图工具', '06-26', '本月'],
  ['bash', '06-25', '本月'],
  ['桌宠提醒策略', '06-22', '本月'],
  ['宠物状态字段', '06-20', '本月'],
  ['桌面文件整理', '06-18', '本月'],
  ['喝水提醒怎么设置', '06-15', '本月'],
  ['查找本地文件', '06-12', '更早'],
  ['番茄钟计划', '06-09', '更早'],
  ['猫咪头像素材', '06-03', '更早'],
  ['Agent 工具权限', '05-30', '更早']
] as const;

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
    history: HISTORY_SEEDS.slice(0, RECENT_HISTORY_LIMIT).map(([title, timeLabel, group], index) => ({
      id: `history-${index + 1}`,
      title,
      timeLabel,
      group,
      messages: [
        {
          id: index * 2 + 1,
          speaker: 'user',
          text: title
        },
        {
          id: index * 2 + 2,
          speaker: 'pet',
          text: '窝先记住这条对话，等 AI 接入后就能继续聊啦。'
        }
      ]
    }))
  };
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CONFIG, IPC, type Config, type LlmProviderId, type PetBehaviorFrequency, type ProactiveFrequency } from '@petsona/shared';
import {
  HOME_SHORTCUTS,
  OWNER_MOODS,
  type HistoryConversation,
  type PanelTab,
  conversationsToHistory,
  createDefaultPanelState,
  getConversationTitle
} from './managementPanelData';
import { PetVideoLayer } from './PetVideoLayer';
import { IDLE_ANIMATION, PET_ACTION_SEQUENCE, type PetAnimation } from './petAnimations';
import { getNextActionIndex, getRandomTailHoldMs } from './petAnimationScheduler';
import {
  PET_PERSONALITY_OPTIONS,
  PET_SPECIES_OPTIONS,
  type PetDataState,
  type PetPersonality,
  type PetProfile,
  type PetSpecies,
  calculateCompanionDays,
  calculatePetAgeLabel,
  formatDateKey,
  loadPetDataState,
  savePetDataState,
  toDateKey
} from './petData';
import sendDefaultIcon from './assets/chat-icons/发送按钮-默认.png';
import sendActiveIcon from './assets/chat-icons/发送按钮-输入后可发送.png';
import { Reminders } from './Reminders';
import { Dropdown } from './Dropdown';
import { TaskRunningNote } from './TaskRunningNote';
import { ModalHost } from './ModalKit';
import iconDelete from './assets/figma/icon-delete-28.svg';
import { isTauri, on, request } from './lib/ipc';
import { useChat } from './lib/useChat';

const CHAT_INPUT_PLACEHOLDER = '聊聊拯救地球の事';
const SHOW_HOME_REMINDERS = false;
const REMINDER_ITEMS = [
  { label: '喝水', valueKey: 'water' },
  { label: '站立', valueKey: 'stand' },
  { label: '番茄', valueKey: 'pomodoro' },
  { label: '待办', valueKey: 'todo' }
] as const;
const UPCOMING_REMINDERS: { label: string; next: string }[] = [];
const DEFAULT_PERSONA_PROMPT = '';
const PERSONA_PROMPT_MAX = 500;
// hint 只出现在展开的下拉菜单里（选中态收起后不再常显时间说明）
const BEHAVIOR_OPTIONS: Array<{ value: PetBehaviorFrequency; label: string; hint: string }> = [
  { value: 'quiet', label: '安静', hint: '约 5 分钟换一次动作' },
  { value: 'normal', label: '正常', hint: '约 2 分钟换一次动作' },
  { value: 'active', label: '活跃', hint: '约 30 秒换一次动作' },
  { value: 'continuous', label: '连续', hint: '动作不间断轮播，每次回到坐姿再接下一个' }
];
const PROACTIVE_OPTIONS: Array<{ value: ProactiveFrequency; label: string; hint: string }> = [
  { value: 'high', label: '活跃', hint: '约 15 分钟一次' },
  { value: 'mid', label: '正常', hint: '约 45 分钟一次' },
  { value: 'low', label: '安静', hint: '约 2 小时一次' },
  { value: 'off', label: '关闭', hint: '不主动闲聊' }
];
const LLM_PROVIDER_OPTIONS: Array<{ value: LlmProviderId; label: string; baseUrl: string; model: string }> = [
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  { value: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { value: 'openai-compatible', label: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', model: '' }
];

function panelTabFromHash(): PanelTab {
  const page = window.location.hash.split('/')[2] ?? '';
  switch (page) {
    case '':
    case 'home':
    case 'panel':
      return 'home';
    case 'data':
    case 'petData':
    case 'pet-data':
      return 'petData';
    case 'chat':
    case 'history':
    case 'conversation':
    case 'conversations':
      return 'history';
    case 'tasks':
    case 'reminders':
      return 'reminders';
    case 'settings':
      return 'settings';
    default:
      return 'home';
  }
}

export function ManagementPanel() {
  const [state] = useState(createDefaultPanelState);
  const [petData, setPetData] = useState<PetDataState>(() => loadPetDataState(typeof window === 'undefined' ? null : window.localStorage));
  const [ownerMood, setOwnerMood] = useState<(typeof OWNER_MOODS)[number]>(state.pet.ownerMood);
  const [activeTab, setActiveTab] = useState<PanelTab>(panelTabFromHash);
  const [hiddenHistoryIds, setHiddenHistoryIds] = useState<Set<string>>(() => new Set());
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [remindersExpanded, setRemindersExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { msgs, conversations, listRef, sendText, startConversation, openConversation: openChatConversation } = useChat()
  const visibleMsgs = msgs
  const hasConversation = visibleMsgs.length > 0;
  const currentTitle = hasConversation ? getConversationTitle(visibleMsgs.find((message) => message.role === 'user')?.text ?? '') : '新聊天';
  const companionDays = calculateCompanionDays(petData.firstCompanionDate);
  const ageLabel = calculatePetAgeLabel(petData.profile.birthday);
  const sidebarPet = {
    avatar: state.pet.avatar,
    name: petData.profile.nickname,
    age: ageLabel,
    weight: petData.profile.weight,
    companionDays,
    ownerMood
  };
  const reminders = REMINDER_ITEMS.map((item) => ({
    label: item.label,
    value: state.stats[item.valueKey]
  }));
  const visibleReminders = UPCOMING_REMINDERS.slice(0, 1);

  useEffect(() => {
    const updateActiveTabFromHash = () => setActiveTab(panelTabFromHash());
    const offPanelNavigate = window.petAgent?.onPanelNavigate((tab) => setActiveTab(tab));
    window.addEventListener('hashchange', updateActiveTabFromHash);
    updateActiveTabFromHash();

    return () => {
      offPanelNavigate?.();
      window.removeEventListener('hashchange', updateActiveTabFromHash);
    };
  }, []);

  useEffect(() => {
    savePetDataState(typeof window === 'undefined' ? null : window.localStorage, petData);
  }, [petData]);

  // 历史列表来自后端会话摘要（真实 conversationId），不再从当前消息流猜分组
  const groupedHistory = useMemo(() => {
    return conversationsToHistory(conversations)
      .filter((item) => !hiddenHistoryIds.has(item.id))
      .reduce<Record<HistoryConversation['group'], HistoryConversation[]>>(
      (groups, item) => {
        groups[item.group].push(item);
        return groups;
      },
      { 今天: [], 昨天: [], 本周: [], 本月: [], 更早: [] }
    );
  }, [hiddenHistoryIds, conversations]);

  const chooseShortcut = (prompt: string) => {
    setInputValue(prompt);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const startNewConversation = () => {
    void startConversation()
    setInputValue('');
    setActiveTab('home');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openConversation = (conversation: HistoryConversation) => {
    // 消息按真实 conversationId 从后端拉取；续聊时后端按同一 id 取近 N 轮做上下文
    void openChatConversation(conversation.id);
    setActiveTab('home');
  };

  const deleteConversation = (conversationId: string) => {
    setHiddenHistoryIds((current) => new Set([...current, conversationId]));
  };

  const sendMessage = () => {
    if (sendText(inputValue)) setInputValue('');
  };

  return (
    <ModalHost>
    <main className="panel-window">
      <div className="panel-window-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <aside className="panel-sidebar">
        <section className="panel-pet-profile" aria-label="宠物状态">
          <div className="panel-pet-line">
            <img className="panel-pet-avatar" src={sidebarPet.avatar} alt="" />
            <div>
              <div className="panel-pet-name">{sidebarPet.name}</div>
              <div className="panel-pet-meta">
                {sidebarPet.age} / {sidebarPet.weight}
              </div>
            </div>
          </div>
          <div className="panel-companion">
            <span>陪伴天数</span>
            <strong>{sidebarPet.companionDays}</strong>
          </div>
          <div className="panel-owner-mood">
            <span>心情</span>
            <MoodSelect value={sidebarPet.ownerMood} onChange={setOwnerMood} />
          </div>
          {SHOW_HOME_REMINDERS ? (
            <section className="panel-reminders" aria-label="当前提醒">
              <button
                className="panel-reminder-toggle"
                type="button"
                aria-expanded={remindersExpanded}
                onClick={() => setRemindersExpanded((expanded) => !expanded)}
              >
                <span>当前提醒</span>
                <span className={remindersExpanded ? 'panel-reminder-caret' : 'panel-reminder-caret collapsed'}>⌄</span>
              </button>
              {visibleReminders.length ? (
                <div className="panel-next-reminder">
                  <span>{visibleReminders[0].label}</span>
                  <small>{visibleReminders[0].next}</small>
                </div>
              ) : null}
              <div className={remindersExpanded ? 'panel-status-grid' : 'panel-status-grid collapsed'}>
                {reminders.map((reminder) => (
                  <StatusCard key={reminder.label} label={reminder.label} value={reminder.value} />
                ))}
              </div>
            </section>
          ) : null}
        </section>

        <nav className="panel-primary-tabs" aria-label="页面切换">
          <SidebarButton active={activeTab === 'home'} label="首页" onClick={() => setActiveTab('home')} />
          <SidebarButton active={activeTab === 'petData'} label="宠物数据" onClick={() => setActiveTab('petData')} />
          <SidebarButton active={activeTab === 'reminders'} label="提醒事项" onClick={() => setActiveTab('reminders')} />
        </nav>

        <section className="panel-history-sidebar">
          <button className="panel-section-title" type="button" onClick={() => setActiveTab('history')}>
            历史对话
          </button>
          <div className="panel-history-list" aria-label="最近历史对话">
            {Object.values(groupedHistory).flat().slice(0, 6).map((conversation) => (
              <div className="panel-history-row" key={conversation.id}>
                <button
                  className="panel-history-open"
                  type="button"
                  onClick={() => openConversation(conversation)}
                >
                  <span>{conversation.title}</span>
                  <small>{conversation.timeLabel}</small>
                </button>
                <button
                  className="panel-history-delete"
                  type="button"
                  aria-label={`删除对话 ${conversation.title}`}
                  title="删除对话"
                  onClick={() => deleteConversation(conversation.id)}
                >
                  <img src={iconDelete} alt="" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <button
          className={activeTab === 'settings' ? 'panel-settings-tab active' : 'panel-settings-tab'}
          type="button"
          onClick={() => setActiveTab('settings')}
        >
          设置中心
        </button>
      </aside>

      <section className="panel-main">
        {activeTab === 'history' ? (
          <HistoryPage groups={groupedHistory} onOpenConversation={openConversation} onDeleteConversation={deleteConversation} />
        ) : activeTab === 'petData' ? (
          <PetDataPage petData={petData} setPetData={setPetData} avatar={sidebarPet.avatar} />
        ) : activeTab === 'home' ? (
          <section className="panel-chat-page">
            <header className="panel-chat-topbar">
              <div className="panel-page-spacer" />
              <h1 className="panel-page-title">{currentTitle}</h1>
              <button className="panel-new-chat" type="button" aria-label="新对话" title="新对话" onClick={startNewConversation}>
                +
              </button>
            </header>

            <div className="panel-chat-body" ref={listRef}>
              {hasConversation ? (
                <div className="panel-message-stack">
                  {visibleMsgs.map((message) => (
                    <div className="panel-message-wrap" data-message-key={message.key} key={message.key}>
                      {message.reasoning && !message.text ? <div className="panel-reasoning">{petData.profile.nickname} 正在来的路上…</div> : null}
                      {(message.text || !message.reasoning) ? (
                        <article className={`panel-message ${message.role === 'user' ? 'user' : 'pet'}${message.error ? ' error' : ''}`}>
                          {message.text}
                          {message.streaming ? <span className="chat-cursor">▍</span> : null}
                        </article>
                      ) : null}
                      {message.tooling ? <TaskRunningNote className="panel-tooling" /> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <section className="panel-welcome" aria-label="首页欢迎">
                  <p>
                    Hi 主人～
                    <br />
                    每天都要开心哦！
                  </p>
                  <div className="panel-shortcuts">
                    {HOME_SHORTCUTS.map((shortcut) => (
                      <button key={shortcut.label} type="button" onClick={() => chooseShortcut(shortcut.prompt)}>
                        <span>{shortcut.icon}</span>
                        {shortcut.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
            {!hasConversation ? <PanelHomePet /> : null}

            <footer className="panel-input-shell">
              <textarea
                ref={inputRef}
                aria-label="首页聊天输入"
                placeholder={inputFocused ? '' : CHAT_INPUT_PLACEHOLDER}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button className="panel-send-button" type="button" disabled={!inputValue.trim()} aria-label="发送消息" onClick={sendMessage}>
                <img src={inputValue.trim() ? sendActiveIcon : sendDefaultIcon} alt="" />
              </button>
            </footer>
          </section>
        ) : activeTab === 'reminders' ? (
          <section className="panel-reminders-page">
            <Reminders />
          </section>
        ) : activeTab === 'settings' ? (
          <SettingsPage />
        ) : (
          <PlaceholderPage title={getTabTitle(activeTab)} />
        )}
      </section>
    </main>
    </ModalHost>
  );
}

type PersonaSettings = {
  persona_id?: string;
  customDescription?: string;
};

type LlmKeyMeta = {
  hasKey: boolean;
  maskedTail?: string;
};

function SettingsPage() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [personaText, setPersonaText] = useState(DEFAULT_PERSONA_PROMPT);
  const [petVisible, setPetVisible] = useState(true);
  const [llmKeyMeta, setLlmKeyMeta] = useState<LlmKeyMeta>({ hasKey: false });
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [toast, setToast] = useState('');
  const [testingApi, setTestingApi] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const personaSaveTimerRef = useRef<number | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 1800);
  };

  const saveConfigPatch = async (patch: Partial<Config>) => {
    try {
      const { config: nextConfig } = await request<{ config: Config }>(IPC.CONFIG_SET, { patch });
      setConfig(nextConfig);
      showToast('已保存');
    } catch {
      showToast('保存失败，请重试');
    }
  };

  useEffect(() => {
    let alive = true;
    void request<{ config: Config }>(IPC.CONFIG_GET, {})
      .then(({ config: nextConfig }) => {
        if (alive) setConfig(normalizeSettingsConfig(nextConfig));
      })
      .catch(() => showToast('设置加载失败'));
    void request<{ persona: PersonaSettings }>(IPC.PERSONA_GET, {})
      .then(({ persona }) => {
        if (alive) setPersonaText((persona.customDescription ?? '').slice(0, PERSONA_PROMPT_MAX));
      })
      .catch(() => undefined);
    void request<LlmKeyMeta>(IPC.LLM_KEY_GET, {})
      .then((meta) => {
        if (alive) setLlmKeyMeta(meta);
      })
      .catch(() => undefined);
    if (isTauri()) {
      void invoke('pet_visibility_get')
        .then((visible) => {
          if (alive) setPetVisible(Boolean(visible));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (personaSaveTimerRef.current !== null) window.clearTimeout(personaSaveTimerRef.current);
    };
  }, []);

  const togglePet = async (nextVisible: boolean) => {
    setPetVisible(nextVisible);
    if (!isTauri()) {
      showToast('已保存');
      return;
    }
    try {
      await invoke('pet_visibility_set', { visible: nextVisible });
      showToast(nextVisible ? '桌宠已显示' : '桌宠已隐藏');
    } catch {
      showToast('保存失败，请重试');
    }
  };

  const changeBehaviorFrequency = (value: PetBehaviorFrequency) => {
    const nextConfig = { ...config, pet: { ...config.pet, behaviorFrequency: value } };
    setConfig(nextConfig);
    void saveConfigPatch({ pet: nextConfig.pet });
  };

  const changeProactiveFrequency = (value: ProactiveFrequency) => {
    const nextConfig = { ...config, proactive: { ...config.proactive, frequency: value } };
    setConfig(nextConfig);
    void saveConfigPatch({ proactive: nextConfig.proactive });
  };

  const changeLlmProvider = (value: LlmProviderId) => {
    const option = LLM_PROVIDER_OPTIONS.find((item) => item.value === value) ?? LLM_PROVIDER_OPTIONS[0];
    const nextConfig = {
      ...config,
      llmDebug: {
        provider: option.value,
        baseUrl: option.baseUrl,
        model: option.model
      }
    };
    setConfig(nextConfig);
  };

  const changePersonaText = (value: string) => {
    const nextValue = value.slice(0, PERSONA_PROMPT_MAX);
    setPersonaText(nextValue);
    if (personaSaveTimerRef.current !== null) window.clearTimeout(personaSaveTimerRef.current);
    personaSaveTimerRef.current = window.setTimeout(() => {
      void request(IPC.PERSONA_SET, { persona: { persona_id: 'default', customDescription: nextValue } })
        .then(() => showToast('已保存'))
        .catch(() => showToast('保存失败，请重试'));
    }, 500);
  };

  const saveLlmDebugConfig = async () => {
    const key = apiKeyDraft.trim();
    try {
      const { config: nextConfig } = await request<{ config: Config }>(IPC.CONFIG_SET, {
        patch: { llmDebug: config.llmDebug }
      });
      setConfig(nextConfig);
      if (key) {
        const meta = await request<LlmKeyMeta>(IPC.LLM_KEY_SET, { key });
        setLlmKeyMeta(meta);
        setApiKeyDraft('');
      }
      showToast('已保存');
    } catch {
      showToast('保存失败，请重试');
    }
  };

  const clearLlmKey = async () => {
    try {
      const meta = await request<LlmKeyMeta>(IPC.LLM_KEY_CLEAR, {});
      setLlmKeyMeta(meta);
      setApiKeyDraft('');
      showToast('API Key 已清除');
    } catch {
      showToast('清除失败，请重试');
    }
  };

  const testLlmConnection = async () => {
    setTestingApi(true);
    try {
      const { config: nextConfig } = await request<{ config: Config }>(IPC.CONFIG_SET, {
        patch: { llmDebug: config.llmDebug }
      });
      setConfig(nextConfig);
      const result = await request<{ ok: boolean; message: string }>(IPC.LLM_DEBUG_TEST, {
        apiKey: apiKeyDraft.trim() || null
      });
      showToast(result.message || (result.ok ? '连接成功' : '连接失败'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '连接失败');
    } finally {
      setTestingApi(false);
    }
  };

  const resetDefaults = () => {
    const nextConfig = {
      ...config,
      pet: DEFAULT_CONFIG.pet,
      proactive: { ...config.proactive, frequency: DEFAULT_CONFIG.proactive.frequency },
      llmDebug: DEFAULT_CONFIG.llmDebug
    };
    setConfig(nextConfig);
    setPersonaText(DEFAULT_PERSONA_PROMPT);
    void saveConfigPatch({
      pet: nextConfig.pet,
      proactive: nextConfig.proactive,
      llmDebug: nextConfig.llmDebug
    });
    void request(IPC.PERSONA_SET, { persona: { persona_id: 'default', customDescription: DEFAULT_PERSONA_PROMPT } }).catch(() => undefined);
  };

  return (
    <section className="settings-page">
      <header className="panel-page-header">
        <div className="panel-page-spacer" />
        <h1 className="panel-page-title">设置中心</h1>
        <div className="panel-page-spacer" />
      </header>

      <div className="settings-content">
        <section className="settings-section" aria-label="基础设置">
          <div className="settings-section-heading">
            <h2>基础设置</h2>
          </div>
          <div className="settings-row">
            <div>
              <strong>开关桌宠</strong>
            </div>
            <button
              className={petVisible ? 'settings-switch on' : 'settings-switch'}
              type="button"
              aria-label={petVisible ? '关闭桌宠显示' : '开启桌宠显示'}
              title={petVisible ? '已显示' : '已隐藏'}
              onClick={() => void togglePet(!petVisible)}
            >
              <span className="settings-switch-thumb" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="settings-section" aria-label="行为设置">
          <div className="settings-section-heading">
            <h2>行为设置</h2>
          </div>
          <SettingsSelect
            label="行为变化"
            value={config.pet.behaviorFrequency}
            options={BEHAVIOR_OPTIONS}
            onChange={changeBehaviorFrequency}
          />
          <SettingsSelect
            label="主动说话"
            value={config.proactive.frequency}
            options={PROACTIVE_OPTIONS}
            onChange={changeProactiveFrequency}
          />
        </section>

        <section className="settings-section" aria-label="自定义宠物描述">
          <div className="settings-section-heading">
            <h2>自定义宠物描述</h2>
          </div>
          <textarea
            className="settings-textarea"
            value={personaText}
            maxLength={PERSONA_PROMPT_MAX}
            aria-label="自定义宠物描述"
            placeholder="例如：糯米有点黏人，说话短短的，喜欢用轻松的语气提醒我休息。"
            onChange={(event) => changePersonaText(event.target.value)}
          />
          <div className="settings-help-row">
            <span>最多 500 字</span>
            <span>{personaText.length}/{PERSONA_PROMPT_MAX}</span>
          </div>
        </section>

        <section className="settings-section settings-section-debug" aria-label="调试设置">
          <div className="settings-section-heading">
            <h2>调试设置</h2>
            {/* 网关安全约束：无 BYOK key 时不接受 provider/baseUrl/model 覆盖（防托管 key 被导向任意端点），SettingsPage 里要说清楚 */}
            <p>Provider / Base URL / Model 需配合你自己的 API Key 保存后才生效；不填 Key 时聊天走云端默认模型。</p>
          </div>
          <div className="settings-field">
            <span>Provider</span>
            <Dropdown
              value={config.llmDebug.provider}
              options={LLM_PROVIDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              onChange={changeLlmProvider}
              ariaLabel="Provider"
            />
          </div>
          <label className="settings-field">
            <span>Base URL</span>
            <input value={config.llmDebug.baseUrl} onChange={(event) => setConfig({ ...config, llmDebug: { ...config.llmDebug, baseUrl: event.target.value } })} />
          </label>
          <label className="settings-field">
            <span>Model</span>
            <input value={config.llmDebug.model} onChange={(event) => setConfig({ ...config, llmDebug: { ...config.llmDebug, model: event.target.value } })} />
          </label>
          <label className="settings-field">
            <span>API Key</span>
            <input value={apiKeyDraft} type="password" placeholder={llmKeyMeta.hasKey ? `已保存，末四位 ${llmKeyMeta.maskedTail ?? '****'}` : '输入 API Key'} onChange={(event) => setApiKeyDraft(event.target.value)} />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={() => void saveLlmDebugConfig()}>保存 API 设置</button>
            <button type="button" onClick={() => void testLlmConnection()} disabled={testingApi}>{testingApi ? '测试中' : '连接测试'}</button>
            <button type="button" onClick={() => void clearLlmKey()} disabled={!llmKeyMeta.hasKey && !apiKeyDraft}>清除 API Key</button>
          </div>
        </section>

        <section className="settings-section settings-section-reset" aria-label="恢复默认设置">
          <div>
            <h2>恢复默认设置</h2>
            <p>恢复普通设置，但不会清除 API Key。</p>
          </div>
          <button type="button" onClick={resetDefaults}>恢复默认设置</button>
        </section>
      </div>

      {toast ? <div className="settings-toast">{toast}</div> : null}
    </section>
  );
}

// 行为设置下拉：档位时间说明放进展开菜单的选项里（hint），收起时不再常显
function SettingsSelect<Value extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string; hint: string }>;
  onChange: (value: Value) => void;
}) {
  return (
    <div className="settings-select-row">
      <div className="settings-choice-title">{label}</div>
      <Dropdown value={value} options={options} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function normalizeSettingsConfig(config: Config): Config {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    pet: { ...DEFAULT_CONFIG.pet, ...(config.pet ?? {}) },
    llmDebug: { ...DEFAULT_CONFIG.llmDebug, ...(config.llmDebug ?? {}) },
    proactive: { ...DEFAULT_CONFIG.proactive, ...(config.proactive ?? {}) }
  };
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel-status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SidebarButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function MoodSelect({
  value,
  onChange
}: {
  value: (typeof OWNER_MOODS)[number];
  onChange: (value: (typeof OWNER_MOODS)[number]) => void;
}) {
  return (
    <div className="panel-owner-mood-select">
      <Dropdown
        value={value}
        options={OWNER_MOODS.map((mood) => ({ value: mood, label: mood }))}
        onChange={onChange}
        ariaLabel="选择主人心情"
        className="mood"
      />
    </div>
  );
}
function useBehaviorFrequency() {
  const [behaviorFrequency, setBehaviorFrequency] = useState<PetBehaviorFrequency>(DEFAULT_CONFIG.pet.behaviorFrequency);

  useEffect(() => {
    let alive = true;
    void request<{ config: Config }>(IPC.CONFIG_GET, {})
      .then(({ config }) => {
        if (alive) setBehaviorFrequency(config.pet?.behaviorFrequency ?? DEFAULT_CONFIG.pet.behaviorFrequency);
      })
      .catch(() => undefined);

    const unsubscribe = on<{ config: Config }>(IPC.CONFIG_UPDATED, ({ config }) => {
      setBehaviorFrequency(config.pet?.behaviorFrequency ?? DEFAULT_CONFIG.pet.behaviorFrequency);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return behaviorFrequency;
}

function PanelHomePet() {
  const [animation, setAnimation] = useState<PetAnimation>(IDLE_ANIMATION);
  const [actionIndex, setActionIndex] = useState(0);
  const behaviorFrequency = useBehaviorFrequency();
  const behaviorFrequencyRef = useRef(behaviorFrequency);
  const animationRef = useRef<PetAnimation>(IDLE_ANIMATION);
  const tailHoldTimerRef = useRef<number | null>(null);

  const switchAnimation = (nextAnimation: PetAnimation) => {
    animationRef.current = nextAnimation;
    setAnimation(nextAnimation);
  };

  const clearTailHold = () => {
    if (tailHoldTimerRef.current === null) return;
    window.clearTimeout(tailHoldTimerRef.current);
    tailHoldTimerRef.current = null;
  };

  useEffect(() => clearTailHold, []);

  const handleAnimationEnded = () => {
    clearTailHold();
    tailHoldTimerRef.current = window.setTimeout(() => {
      if (animationRef.current.id === 'idle') {
        setActionIndex((current) => {
          const nextAnimation = PET_ACTION_SEQUENCE[current % PET_ACTION_SEQUENCE.length];
          switchAnimation(nextAnimation);
          return getNextActionIndex(current, PET_ACTION_SEQUENCE.length);
        });
        return;
      }

      switchAnimation(IDLE_ANIMATION);
    }, getRandomTailHoldMs(behaviorFrequencyRef.current));
  };

  // 与 PetWindow 同款：频率变化即刻重排等待中的切换，设置立即可感知
  useEffect(() => {
    behaviorFrequencyRef.current = behaviorFrequency;
    if (tailHoldTimerRef.current !== null) handleAnimationEnded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behaviorFrequency]);

  return (
    <div className="panel-home-pet" aria-hidden="true">
      <PetVideoLayer activeAnimation={animation} onEnded={handleAnimationEnded} />
    </div>
  );
}

function PetDataPage({
  petData,
  setPetData,
  avatar
}: {
  petData: PetDataState;
  setPetData: React.Dispatch<React.SetStateAction<PetDataState>>;
  avatar: string;
}) {
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | null>(null);
  const companionDays = calculateCompanionDays(petData.firstCompanionDate);
  const ageLabel = calculatePetAgeLabel(petData.profile.birthday);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 1600);
  };

  const updateProfile = <Key extends keyof PetProfile>(key: Key, value: PetProfile[Key]) => {
    setPetData((current) => ({
      ...current,
      profile: {
        ...current.profile,
        [key]: value
      }
    }));
    showToast('已保存');
  };

  return (
    <section className="panel-pet-data-page">
      <header className="panel-page-header">
        <div className="panel-page-spacer" />
        <h1 className="panel-page-title">宠物数据</h1>
        <div className="panel-page-spacer" />
      </header>

      <div className="pet-data-content">
        <section className="pet-data-identity" aria-label="宠物身份">
          <img className="pet-data-avatar" src={avatar} alt="" />
          <div className="pet-data-identity-main">
            <InlineEditableField
              className="pet-data-name-editor"
              label="昵称"
              value={petData.profile.nickname}
              ariaLabel="编辑宠物昵称"
              onSave={(value) => updateProfile('nickname', value || '糯米')}
            />
            <div className="pet-data-id">宠宠号：{petData.petId}</div>
          </div>
        </section>

        <section className="pet-data-profile-grid" aria-label="宠物资料">
          <SelectProfileField
            label="宠物种类"
            value={petData.profile.species}
            options={PET_SPECIES_OPTIONS}
            onChange={(value) => updateProfile('species', value as PetSpecies)}
          />
          <SelectProfileField
            label="性格"
            value={petData.profile.personality}
            options={PET_PERSONALITY_OPTIONS}
            onChange={(value) => updateProfile('personality', value as PetPersonality)}
          />
          <TextProfileField label="品种" value={petData.profile.breed} onSave={(value) => updateProfile('breed', value || '布偶猫')} />
          <TextProfileField label="体重" value={petData.profile.weight} onSave={(value) => updateProfile('weight', value || '7.8千克')} />
          <PetDatePicker label="宠物生日" value={petData.profile.birthday} onChange={(value) => updateProfile('birthday', value)} />
          <ReadOnlyProfileField label="宠物年龄" value={ageLabel} />
          <PetDatePicker label="上次驱虫" value={petData.profile.lastDewormedAt} onChange={(value) => updateProfile('lastDewormedAt', value)} />
          <PetDatePicker label="上次疫苗" value={petData.profile.lastVaccinatedAt} onChange={(value) => updateProfile('lastVaccinatedAt', value)} />
        </section>

        <section className="pet-library-section" aria-label="宠物库">
          <div className="pet-library-heading">
            <h2>宠物库</h2>
          </div>
          <div className="pet-library-grid">
            <CurrentPetLibraryCard />
            <button className="pet-library-card upload" type="button" onClick={() => showToast('功能待上线')}>
              <span className="pet-library-plus">+</span>
              <strong>上传定制化宠物</strong>
            </button>
            {Array.from({ length: 4 }).map((_, index) => (
              <button className="pet-library-card locked" type="button" key={index} onClick={() => showToast('功能待上线')}>
                待上线
              </button>
            ))}
          </div>
        </section>
      </div>

      {toast ? <div className="panel-toast">{toast}</div> : null}
    </section>
  );
}

function InlineEditableField({
  label,
  value,
  ariaLabel,
  onSave,
  className = ''
}: {
  label: string;
  value: string;
  ariaLabel: string;
  onSave: (value: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const nextValue = draft.trim();
    if (nextValue !== value) onSave(nextValue);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`pet-inline-input ${className}`}
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button className={`pet-inline-value ${className}`} type="button" aria-label={ariaLabel} onClick={() => setEditing(true)}>
      <span>{value}</span>
      <small aria-hidden="true">✎</small>
    </button>
  );
}

function TextProfileField({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) {
  return (
    <div className="pet-profile-field">
      <span>{label}</span>
      <InlineEditableField label={label} value={value} ariaLabel={`编辑${label}`} onSave={onSave} />
    </div>
  );
}

function SelectProfileField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="pet-profile-field">
      <span>{label}</span>
      <Dropdown
        value={value}
        options={options.map((option) => ({ value: option, label: option }))}
        onChange={onChange}
        ariaLabel={label}
      />
    </div>
  );
}

function ReadOnlyProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="pet-profile-field readonly">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PetDatePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [datePopoverDirection, setDatePopoverDirection] = useState<'down' | 'up'>('down');
  const [selectedDate, setSelectedDate] = useState(value);
  const [viewDate, setViewDate] = useState(() => dateFromKey(value));
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const days = getCalendarDays(viewDate);

  useEffect(() => {
    setSelectedDate(value);
    setViewDate(dateFromKey(value));
  }, [value]);

  const shiftMonth = (delta: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const confirm = () => {
    setOpen(false);
    if (selectedDate !== value) onChange(selectedDate);
  };

  const openCalendar = () => {
    const bounds = fieldRef.current?.getBoundingClientRect();
    if (bounds) {
      const popoverHeight = 332;
      const bottomSpace = window.innerHeight - bounds.bottom;
      const topSpace = bounds.top;
      setDatePopoverDirection(bottomSpace < popoverHeight && topSpace > bottomSpace ? 'up' : 'down');
    }
    setOpen((current) => !current);
  };

  return (
    <div className="pet-profile-field pet-date-field" ref={fieldRef}>
      <span>{label}</span>
      <button className="pet-date-trigger" type="button" onClick={openCalendar}>
        {formatDateKey(value)}
      </button>
      {open ? (
        <div className={datePopoverDirection === 'up' ? 'pet-date-popover open-upward' : 'pet-date-popover'}>
          <div className="pet-date-monthbar">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="上个月">
              ‹
            </button>
            <strong>
              {viewDate.getFullYear()}年{viewDate.getMonth() + 1}月
            </strong>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="下个月">
              ›
            </button>
          </div>
          <div className="pet-date-weekdays">
            {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="pet-date-grid">
            {days.map((day) => (
              <button
                className={day.dateKey === selectedDate ? 'selected' : ''}
                type="button"
                key={day.dateKey}
                disabled={!day.inMonth}
                onClick={() => setSelectedDate(day.dateKey)}
              >
                {day.label}
              </button>
            ))}
          </div>
          <div className="pet-date-actions">
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="button" onClick={confirm}>
              确认
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CurrentPetLibraryCard() {
  const [hovering, setHovering] = useState(false);

  return (
    <button
      className="pet-library-card current"
      type="button"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      aria-label="当前使用的宠物形象"
    >
      <div className="pet-library-video">
        <video className="pet-library-still" src={IDLE_ANIMATION.src} muted playsInline preload="metadata" draggable={false} />
        {hovering ? <PetVideoLayer activeAnimation={PET_ACTION_SEQUENCE[0]} onEnded={() => setHovering(false)} /> : null}
      </div>
      <span className="pet-library-current-badge">当前使用</span>
    </button>
  );
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year || 2026, (month || 1) - 1, day || 1);
}

function getCalendarDays(viewDate: Date) {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      dateKey: toDateKey(date),
      label: date.getDate(),
      inMonth: date.getMonth() === viewDate.getMonth()
    };
  });
}

function HistoryPage({
  groups,
  onOpenConversation,
  onDeleteConversation
}: {
  groups: Record<HistoryConversation['group'], HistoryConversation[]>;
  onOpenConversation: (conversation: HistoryConversation) => void;
  onDeleteConversation: (conversationId: string) => void;
}) {
  const orderedGroups: HistoryConversation['group'][] = ['今天', '昨天', '本周', '本月', '更早'];
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = orderedGroups.reduce<Record<HistoryConversation['group'], HistoryConversation[]>>((next, group) => {
    const items = groups[group].filter((conversation) => {
      if (!normalizedQuery) return true;
      // 会话消息已不随列表下发（按需拉取），搜索范围收敛为标题+时间
      return (
        conversation.title.toLowerCase().includes(normalizedQuery) ||
        conversation.timeLabel.toLowerCase().includes(normalizedQuery)
      );
    });
    next[group] = items;
    return next;
  }, { 今天: [], 昨天: [], 本周: [], 本月: [], 更早: [] });

  return (
    <section className="panel-history-page">
      <header className="panel-page-header">
        <div className="panel-page-spacer" />
        <h1 className="panel-page-title">历史对话</h1>
        <div className="panel-page-spacer" />
      </header>
      <input
        className="panel-history-search"
        type="search"
        placeholder="搜索历史对话"
        aria-label="搜索历史对话"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="panel-history-groups">
        {orderedGroups.map((group) =>
          filteredGroups[group].length ? (
            <section className="panel-history-group" key={group}>
              <h2>{group}</h2>
              {filteredGroups[group].map((conversation) => (
                <div className="panel-history-result-row" key={conversation.id}>
                  <button type="button" onClick={() => onOpenConversation(conversation)}>
                    <span>{conversation.title}</span>
                    <small>{conversation.timeLabel}</small>
                  </button>
                  <button
                    className="panel-history-delete"
                    type="button"
                    aria-label={`删除对话 ${conversation.title}`}
                    title="删除对话"
                    onClick={() => onDeleteConversation(conversation.id)}
                  >
                    <img src={iconDelete} alt="" />
                  </button>
                </div>
              ))}
            </section>
          ) : null
        )}
      </div>
    </section>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="panel-placeholder-page">
      <header className="panel-page-header">
        <div className="panel-page-spacer" />
        <h1 className="panel-page-title">{title}</h1>
        <div className="panel-page-spacer" />
      </header>
      <p>这一页先按 MVP 放置入口，后续接入真实数据和设置项。</p>
    </section>
  );
}

function getTabTitle(tab: PanelTab) {
  switch (tab) {
    case 'petData':
      return '宠物数据';
    case 'reminders':
      return '提醒事项';
    case 'settings':
      return '设置中心';
    default:
      return '首页';
  }
}

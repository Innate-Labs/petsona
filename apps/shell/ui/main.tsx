import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { DEFAULT_CONFIG, IPC, type Config, type PetBehaviorFrequency } from '@petsona/shared';
import { ManagementPanel } from './ManagementPanel';
import { PetVideoLayer } from './PetVideoLayer';
import { installPetAgentBridge } from './petAgentBridge';
import { DRAG_ANIMATION, IDLE_ANIMATION, PET_ACTION_SEQUENCE, type PetAnimation } from './petAnimations';
import { getNextActionIndex, getRandomTailHoldMs, PROACTIVE_BUBBLE_VISIBLE_MS } from './petAnimationScheduler';
import { on, request } from './lib/ipc';
import avatarIcon from './assets/chat-icons/头像.png';
import closeDefaultIcon from './assets/chat-icons/关闭=默认.png';
import closeHoverIcon from './assets/chat-icons/关闭=悬停.png';
import pinDefaultIcon from './assets/chat-icons/钉住=默认-1.png';
import pinHoverIcon from './assets/chat-icons/钉住=悬停-1.png';
import pinActiveIcon from './assets/chat-icons/钉住=钉住.png';
import sendDefaultIcon from './assets/chat-icons/发送按钮-默认.png';
import sendActiveIcon from './assets/chat-icons/发送按钮-输入后可发送.png';
import './styles.css';

type View = 'pet' | 'chat' | 'panel';
type ChatMessage = { id: number; speaker: 'pet' | 'user'; text: string };

const MIN_CHAT_INPUT_HEIGHT = 118;
const MAX_CHAT_INPUT_HEIGHT = 236;
const CHAT_INPUT_CHROME_HEIGHT = 72;
const PET_DRAG_MOVE_THRESHOLD_PX = 6;
const PET_PICK_UP_DELAY_MS = 2000;
const MIN_PET_SIZE = 180;
const MAX_PET_SIZE = 420;

installPetAgentBridge();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getView(): View {
  if (window.location.hash.startsWith('#/float')) return 'chat';
  if (window.location.hash.startsWith('#/panel')) return 'panel';

  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'chat' || view === 'panel') return view;
  return 'pet';
}

function isBrowserPreview() {
  const params = new URLSearchParams(window.location.search);
  return params.get('preview') === '1';
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function PetView() {
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [animation, setAnimation] = useState<PetAnimation>(IDLE_ANIMATION);
  const [actionIndex, setActionIndex] = useState(0);
  const [behaviorFrequency, setBehaviorFrequency] = useState<PetBehaviorFrequency>(DEFAULT_CONFIG.pet.behaviorFrequency);
  const animationRef = React.useRef<PetAnimation>(IDLE_ANIMATION);
  const tailHoldTimerRef = React.useRef<number | null>(null);
  const pendingPetPressRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pickUpTimer: number;
    dragging: boolean;
  } | null>(null);
  const lastPetMenuAtRef = React.useRef(0);

  const switchAnimation = (nextAnimation: PetAnimation) => {
    animationRef.current = nextAnimation;
    setAnimation(nextAnimation);
  };

  const clearTailHold = () => {
    if (tailHoldTimerRef.current !== null) {
      window.clearTimeout(tailHoldTimerRef.current);
      tailHoldTimerRef.current = null;
    }
  };

  const clearPendingPetPress = () => {
    const pendingPress = pendingPetPressRef.current;
    if (!pendingPress) return;

    window.clearTimeout(pendingPress.pickUpTimer);
    pendingPetPressRef.current = null;
  };

  useEffect(() => {
    let hideBubbleTimer: number | null = null;
    const bubbleTimer = window.setTimeout(() => {
      setBubbleVisible(true);
      hideBubbleTimer = window.setTimeout(() => setBubbleVisible(false), PROACTIVE_BUBBLE_VISIBLE_MS);
    }, 2800);

    return () => {
      window.clearTimeout(bubbleTimer);
      if (hideBubbleTimer !== null) window.clearTimeout(hideBubbleTimer);
      clearTailHold();
      clearPendingPetPress();
    };
  }, []);

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

  const openChat = () => {
    setBubbleVisible(false);
    void window.petAgent?.openChat();
  };

  const openPetMenu = () => {
    const now = Date.now();
    if (now - lastPetMenuAtRef.current < 250) return;

    lastPetMenuAtRef.current = now;
    if (isTauriRuntime()) void invoke('show_pet_menu').catch((error) => console.warn('[pet-menu] show failed', error));
  };

  const openPetContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openPetMenu();
  };

  const openPetMenuOnRightPointer = (event: React.PointerEvent) => {
    if (event.button !== 2) return;

    event.preventDefault();
    event.stopPropagation();
    openPetMenu();
  };

  const handleAnimationEnded = () => {
    if (animationRef.current.id === 'drag') return;
    clearTailHold();
    tailHoldTimerRef.current = window.setTimeout(() => {
      if (animationRef.current.id === 'drag') return;

      if (animationRef.current.id === 'idle') {
        setActionIndex((current) => {
          const nextAnimation = PET_ACTION_SEQUENCE[current % PET_ACTION_SEQUENCE.length];
          switchAnimation(nextAnimation);
          return getNextActionIndex(current, PET_ACTION_SEQUENCE.length);
        });
        return;
      }

      switchAnimation(IDLE_ANIMATION);
    }, getRandomTailHoldMs(behaviorFrequency));
  };

  const beginPetPickUp = () => {
    const pendingPress = pendingPetPressRef.current;
    if (!pendingPress || pendingPress.dragging) return;

    pendingPress.dragging = true;
    clearTailHold();
    switchAnimation(DRAG_ANIMATION);
    void window.petAgent?.beginPetDrag();
  };

  const finishPetPress = () => {
    const wasDragging = pendingPetPressRef.current?.dragging ?? false;
    clearPendingPetPress();

    if (!wasDragging) return;

    switchAnimation(IDLE_ANIMATION);
    void window.petAgent?.endPetDrag();
  };

  const startPetResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    clearPendingPetPress();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = Math.max(window.innerWidth, window.innerHeight);

    const resize = (moveEvent: PointerEvent) => {
      const delta = Math.max(moveEvent.clientX - startX, moveEvent.clientY - startY);
      const nextSize = clamp(startSize + delta, MIN_PET_SIZE, MAX_PET_SIZE);
      void window.petAgent?.resizePet(nextSize);
    };

    const stopResize = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  return (
    <main className="pet-stage" onPointerDownCapture={openPetMenuOnRightPointer} onContextMenu={openPetContextMenu}>
      {bubbleVisible ? (
        <button className="pet-bubble" data-no-drag="true" onClick={openChat} type="button">
          人，窝无聊
        </button>
      ) : null}
      <PetVideoLayer activeAnimation={animation} onEnded={handleAnimationEnded} />
      <div
        className="pet-hit-area"
        onDoubleClick={openChat}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          clearPendingPetPress();
          pendingPetPressRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            pickUpTimer: window.setTimeout(beginPetPickUp, PET_PICK_UP_DELAY_MS),
            dragging: false
          };
        }}
        onPointerMove={(event) => {
          const pendingPress = pendingPetPressRef.current;
          if (!pendingPress || pendingPress.pointerId !== event.pointerId) return;

          const deltaX = event.clientX - pendingPress.startX;
          const deltaY = event.clientY - pendingPress.startY;
          const movedDistance = Math.hypot(deltaX, deltaY);
          if (movedDistance >= PET_DRAG_MOVE_THRESHOLD_PX) beginPetPickUp();
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          finishPetPress();
        }}
        onPointerCancel={finishPetPress}
      />
      <button
        className="pet-resize-handle"
        data-no-drag="true"
        type="button"
        aria-label="调整宠物大小"
        title="调整大小"
        onPointerDown={startPetResize}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path d="M6 4H3v3" />
          <path d="M3 4l5 5" />
          <path d="M12 14h3v-3" />
          <path d="M15 14l-5-5" />
        </svg>
      </button>
    </main>
  );
}

function ChatView() {
  const [pinned, setPinned] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(MIN_CHAT_INPUT_HEIGHT);
  const [pinHovering, setPinHovering] = useState(false);
  const [closeHovering, setCloseHovering] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const hasInput = inputValue.trim().length > 0;

  const startChatResize = (direction: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest') => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().startResizeDragging(direction);
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    void win.setShadow(false);
    void win.setResizable(true);
    void win.setSize(new LogicalSize(412, 537));
    void win.setMinSize(new LogicalSize(412, 537));
    void win.setMaxSize(new LogicalSize(872, 1092));
  }, []);

  useEffect(() => {
    return window.petAgent?.onPinnedChanged(setPinned);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const nextTextHeight = Math.max(46, textarea.scrollHeight);
    setInputHeight((current) => {
      const autoHeight = clamp(nextTextHeight + CHAT_INPUT_CHROME_HEIGHT, MIN_CHAT_INPUT_HEIGHT, MAX_CHAT_INPUT_HEIGHT);
      return Math.max(current > autoHeight && inputValue ? current : autoHeight, MIN_CHAT_INPUT_HEIGHT);
    });
  }, [inputValue]);

  const togglePinned = () => {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    void window.petAgent?.setChatPinned(nextPinned);
  };

  const sendMessage = () => {
    const text = inputValue.trim();
    if (!text) return;

    setMessages((current) => [...current, { id: Date.now(), speaker: 'user', text }]);
    setInputValue('');
    setInputHeight(MIN_CHAT_INPUT_HEIGHT);
  };

  const startInputResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = inputHeight;

    const resize = (moveEvent: PointerEvent) => {
      setInputHeight(clamp(startHeight + startY - moveEvent.clientY, MIN_CHAT_INPUT_HEIGHT, MAX_CHAT_INPUT_HEIGHT));
    };

    const stopResize = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  return (
    <main className="chat-window">
      <section className="chat-shell" style={{ '--chat-input-height': `${inputHeight}px` } as React.CSSProperties}>
        <header className="chat-header" data-tauri-drag-region>
          <button
            className="chat-avatar-button"
            type="button"
            aria-label="打开主面板"
            title="打开主面板"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void window.petAgent?.openPanel('home');
            }}
          >
            <img className="chat-avatar" src={avatarIcon} alt="" />
          </button>
          <button
            className="chat-icon-button pin-button"
            type="button"
            onClick={togglePinned}
            onMouseEnter={() => setPinHovering(true)}
            onMouseLeave={() => setPinHovering(false)}
            aria-label={pinned ? '取消固定聊天窗' : '固定聊天窗'}
            title={pinned ? '取消固定' : '固定'}
          >
            <img src={pinned ? pinActiveIcon : pinHovering ? pinHoverIcon : pinDefaultIcon} alt="" />
          </button>
          <button
            className="chat-icon-button close-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void window.petAgent?.hideChat();
            }}
            onMouseEnter={() => setCloseHovering(true)}
            onMouseLeave={() => setCloseHovering(false)}
            aria-label="关闭聊天窗"
            title="关闭"
          >
            <img src={closeHovering ? closeHoverIcon : closeDefaultIcon} alt="" />
          </button>
        </header>

        <section className="chat-messages" aria-label="聊天消息">
          {messages.map((message) => (
            <article className={`message ${message.speaker}`} key={message.id}>
              {message.text}
            </article>
          ))}
        </section>

        <footer className="chat-input-row" style={{ height: inputHeight }}>
          <div
            className="chat-input-resize-handle"
            role="separator"
            aria-label="调整输入框高度"
            aria-orientation="horizontal"
            onPointerDown={startInputResize}
          />
          <textarea
            ref={textareaRef}
            aria-label="聊天输入"
            placeholder={inputFocused ? '' : '聊聊拯救地球の事'}
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
          <button className="send-button" type="button" aria-label="发送消息" disabled={!hasInput} onClick={sendMessage}>
            <img src={hasInput ? sendActiveIcon : sendDefaultIcon} alt="" />
          </button>
        </footer>
      </section>
      <div className="chat-resize-edge north" onPointerDown={() => startChatResize('North')} />
      <div className="chat-resize-edge south" onPointerDown={() => startChatResize('South')} />
      <div className="chat-resize-edge east" onPointerDown={() => startChatResize('East')} />
      <div className="chat-resize-edge west" onPointerDown={() => startChatResize('West')} />
      <div className="chat-resize-corner north-east" onPointerDown={() => startChatResize('NorthEast')} />
      <div className="chat-resize-corner north-west" onPointerDown={() => startChatResize('NorthWest')} />
      <div className="chat-resize-corner south-east" onPointerDown={() => startChatResize('SouthEast')} />
      <div className="chat-resize-corner south-west" onPointerDown={() => startChatResize('SouthWest')} />
    </main>
  );
}

function App() {
  const [view, setView] = useState<View>(getView);

  useEffect(() => {
    const updateRoute = () => setView(getView());
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  useEffect(() => {
    document.body.dataset.route = view === 'chat' ? 'float' : view;
    if (view === 'panel' && isTauriRuntime()) void getCurrentWindow().setTitle('');
  }, [view]);

  if (isBrowserPreview()) {
    return (
      <main className="browser-preview">
        <section className="preview-pet-panel">
          <PetView />
        </section>
        <section className="preview-chat-panel">
          <ChatView />
        </section>
      </main>
    );
  }

  if (view === 'chat') return <ChatView />;
  if (view === 'panel') return <ManagementPanel />;
  return <PetView />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

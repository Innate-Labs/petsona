// panel/Home.tsx —— 首页（Figma 82:2040）：问候 + 陪伴天数 + 心情 + 2×2 功能卡 + 快捷输入框（第三轮验收增补）

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { ChatHistoryGetRes, Emotion, PetEmotionSignalPayload } from '@petsona/shared'
import { on, request } from '../lib/ipc'
import { EMOTION_META } from '../lib/emotion'
import { companionDays, loadProfile } from '../lib/local'
import { CHAT_SEED_KEY } from '../lib/chatSeed'
import { SpriteFigure } from '../pet/Sprite'
import cardCircle from '../assets/figma/card-icon-circle-46.svg'
import glyphData from '../assets/figma/icon-data-24.svg'
import glyphChat from '../assets/figma/icon-chat-32.svg'
import glyphBell from '../assets/figma/icon-bell-24.svg'
import glyphGear from '../assets/figma/icon-gear-24.svg'
import iconSend from '../assets/figma/icon-send-hover-28.svg'
import iconSendGray from '../assets/figma/icon-send-gray-28.svg'

function Card(props: {
  active?: boolean
  glyph: string
  value?: string
  sub: string
  title: string
  onClick: () => void
}) {
  return (
    <button className={`home-card${props.active ? ' home-card--active' : ''}`} onClick={props.onClick}>
      <span className="home-card-top">
        <span className="home-card-icon">
          <img src={cardCircle} alt="" />
          <img className="glyph" src={props.glyph} alt="" />
        </span>
        {props.value && <span className="home-card-value">{props.value}</span>}
      </span>
      <span className="home-card-sub">{props.sub}</span>
      <span className="home-card-title">{props.title}</span>
    </button>
  )
}

export function Home({ nav }: { nav: (page: string) => void }) {
  const profile = loadProfile()
  const [emotion, setEmotion] = useState<Emotion>('happy')
  const [chatCount, setChatCount] = useState<number | null>(null)
  const [clock, setClock] = useState(() => new Date().toTimeString().slice(0, 5))
  const [draft, setDraft] = useState('')

  useEffect(() => {
    // 面板窗没有情绪状态机（在宠物窗），这里只被动听广播刷新「心情」行
    const off = on<PetEmotionSignalPayload>(IPC.PET_EMOTION_SIGNAL, (p) => setEmotion(p.state))
    void request<ChatHistoryGetRes>(IPC.CHAT_HISTORY_GET, { limit: 50 })
      .then((res) => setChatCount(res.turns.length))
      .catch(() => setChatCount(null))
    const t = setInterval(() => setClock(new Date().toTimeString().slice(0, 5)), 30_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  const mood = EMOTION_META[emotion]

  // Enter/发送：把草稿存到 sessionStorage（Chat.tsx 挂载时 pop 消费），再跳转
  // 为什么 sessionStorage 不走 hash 参数：Chat 的 useChat 里 request(CHAT_SEND) 需要原文（含标点/换行），
  //   hash 编码可用但每次跳转都要 URL-safe 处理；sessionStorage 更直接，且 seed 被消费即清，不残留
  const submitDraft = () => {
    const text = draft.trim()
    if (!text) return
    try {
      window.sessionStorage.setItem(CHAT_SEED_KEY, text)
    } catch {
      // sessionStorage 被禁（隐私模式/漏配置）时降级：先跳过去，用户手动重发也 OK
    }
    setDraft('')
    nav('chat')
  }

  return (
    <>
      <div className="home-hero">
        <p className="home-greet">
          Hi 主人～
          <br />
          每天都要开心哦！
        </p>
        <p className="home-days-label">已陪伴你</p>
        <div className="home-days">
          {companionDays(profile)}
          <span>天</span>
        </div>
        <p className="home-mood">
          心情：{mood.emoji} {mood.label}
        </p>
        <div className="home-pet">
          <SpriteFigure emotion={emotion} />
        </div>
      </div>
      <div className="home-grid">
        <Card
          glyph={glyphData}
          value={profile.weight.replace('千克', 'kg')}
          sub={`${profile.age.split('月')[0].split('岁')[0]}岁｜${profile.personality}粘人`}
          title="宠物数据"
          onClick={() => nav('data')}
        />
        <Card
          active
          glyph={glyphChat}
          value={chatCount === null ? '—' : `${chatCount}条`}
          sub="我能知道你在想什么"
          title="对话记录"
          onClick={() => nav('chat')}
        />
        <Card glyph={glyphBell} value={clock} sub="番茄钟｜喝水｜站立" title="提醒事项" onClick={() => nav('reminders')} />
        <Card glyph={glyphGear} sub="显示桌宠｜高主动" title="设置中心" onClick={() => nav('settings')} />
      </div>
      {/* 快捷输入框（第三轮真机验收增补）：Enter 发送 → 跳对话记录页并把这条塞进消息流 */}
      <div className="home-quick">
        <textarea
          className="home-quick-input"
          value={draft}
          placeholder="有事跟我说～直接发就跳到聊天里"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submitDraft()
            }
          }}
        />
        <button className="send-btn" onClick={submitDraft} aria-label="发送">
          <img src={draft.trim() ? iconSend : iconSendGray} alt="" />
        </button>
      </div>
    </>
  )
}

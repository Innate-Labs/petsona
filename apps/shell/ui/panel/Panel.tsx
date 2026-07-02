// panel/Panel.tsx —— 主面板：左侧 tab 导航 + 登录态门控（§0 桌面强制登录）

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { AuthStateChangedPayload } from '@petsona/shared'
import { on } from '../lib/ipc'
import { Chat } from './Chat'
import { Tasks } from './Tasks'
import { Approval } from './Approval'
import { MemoryManager } from './MemoryManager'
import { Reminders } from './Reminders'
import { Settings } from './Settings'
import { Login } from './Login'

const TABS = [
  { id: 'chat', label: '聊天' },
  { id: 'tasks', label: '任务' },
  { id: 'approval', label: '审批' },
  { id: 'memory', label: '记忆' },
  { id: 'reminders', label: '提醒' },
  { id: 'settings', label: '设置' },
] as const
type TabId = (typeof TABS)[number]['id']

// 支持 open_panel(route) / 宠物菜单直达：#/panel/<tab>
function tabFromHash(): TabId {
  const seg = window.location.hash.split('/')[2] ?? ''
  return TABS.some((t) => t.id === seg) ? (seg as TabId) : 'chat'
}

export function Panel() {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  // 为什么默认 anon：消息表没有 AUTH_STATE_GET，初始态只能按未登录渲染，
  // 依赖 harness 在 UI 桥接建立后主动广播一次 AUTH_STATE_CHANGED 放行（假设已在交付说明标注）
  const [auth, setAuth] = useState<AuthStateChangedPayload>({ loginState: 'anon' })

  useEffect(() => {
    const offAuth = on<AuthStateChangedPayload>(IPC.AUTH_STATE_CHANGED, setAuth)
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      offAuth()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  // 强制登录：未登录只给登录页，不渲染任何业务 tab
  if (auth.loginState !== 'logged_in') {
    return (
      <div className="panel panel--login">
        <Login />
      </div>
    )
  }

  return (
    <div className="panel">
      <nav className="panel-nav">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <div className="panel-user" title={auth.email}>
          {auth.email ?? ''}
        </div>
      </nav>
      <main className="panel-main">
        {tab === 'chat' && <Chat />}
        {tab === 'tasks' && <Tasks />}
        {tab === 'approval' && <Approval />}
        {tab === 'memory' && <MemoryManager />}
        {tab === 'reminders' && <Reminders />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  )
}

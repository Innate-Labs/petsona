// panel/Panel.tsx —— 主面板：首页 2×2 直达四子页（Figma IA）+ 登录态门控（§0 桌面强制登录）
// 审批/记忆不在 Figma 页面图内，保留深链与设置中心入口（Gate 流程不破坏）。

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { AuthStateChangedPayload } from '@petsona/shared'
import { on, request } from '../lib/ipc'
import { loadProfile } from '../lib/local'
import { PageShell } from './kit'
import { Home } from './Home'
import { PetData } from './PetData'
import { Chat } from './Chat'
import { Approval } from './Approval'
import { MemoryManager } from './MemoryManager'
import { Reminders } from './Reminders'
import { Settings } from './Settings'
import { Login } from './Login'
import './panel.css'

const SUBPAGES = {
  data: { title: '宠物数据', comp: PetData },
  chat: { title: '对话记录', comp: Chat },
  reminders: { title: '提醒事项', comp: Reminders },
  settings: { title: '设置中心', comp: Settings },
  approval: { title: '审批与撤销', comp: Approval },
  memory: { title: '记忆管理', comp: MemoryManager },
} as const
type PageId = 'home' | keyof typeof SUBPAGES

// 深链兼容：#/panel/<page>；旧 tab id「tasks」并入提醒事项页
function pageFromHash(): PageId {
  const seg = window.location.hash.split('/')[2] ?? ''
  if (seg === 'tasks') return 'reminders'
  return seg in SUBPAGES ? (seg as PageId) : 'home'
}

export function Panel() {
  const [page, setPage] = useState<PageId>(pageFromHash)
  // 默认 anon：初始态按未登录渲染，等 harness 广播 AUTH_STATE_CHANGED 放行
  const [auth, setAuth] = useState<AuthStateChangedPayload>({ loginState: 'anon' })

  useEffect(() => {
    const offAuth = on<AuthStateChangedPayload>(IPC.AUTH_STATE_CHANGED, setAuth)
    // 广播 + 拉取双保险：harness 恢复登录态的广播可能早于本窗口订阅（真机竞态实测），挂载时补拉一次
    void request<AuthStateChangedPayload>(IPC.AUTH_STATE_GET)
      .then(setAuth)
      .catch(() => {}) // 拉不到就维持 anon，等广播兜底
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      offAuth()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  const nav = (p: string) => {
    window.location.hash = p === 'home' ? '#/panel' : `#/panel/${p}`
  }

  if (auth.loginState !== 'logged_in') {
    return (
      <div className="panel-shell panel--login">
        <Login />
      </div>
    )
  }

  if (page === 'home') {
    return (
      <PageShell petName={loadProfile().name}>
        <Home nav={nav} />
      </PageShell>
    )
  }

  const def = SUBPAGES[page]
  const Comp = def.comp

  return (
    <PageShell title={def.title} onBack={() => nav('home')}>
      <Comp />
    </PageShell>
  )
}

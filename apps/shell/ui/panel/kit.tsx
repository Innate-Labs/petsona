// panel/kit.tsx —— 面板通用小件：页壳/页头/页脚/头像（组件库 页头32:4143·页脚32:4008·宠物头像32:4117）

import type { ReactNode } from 'react'
import iconBack from '../assets/figma/icon-back-18.svg'
import iconClose from '../assets/figma/icon-close-18.svg'
import { CHARACTER } from '../lib/character'
import { isTauri } from '../lib/ipc'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function PetAvatar({ size = 32 }: { size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <img src={CHARACTER.avatar} alt="宠物头像" />
    </span>
  )
}

function closeWindow() {
  // 浏览器原型没有窗口可关，退回首页方便演示循环
  if (isTauri()) void getCurrentWindow().hide()
  else window.location.hash = '#/panel'
}

/** 页头：home 变体（头像+名）与子页变体（返回+居中标题）；关闭按钮两者共有 */
export function PageHead(props: { title?: string; petName?: string; onBack?: () => void }) {
  const { title, petName, onBack } = props
  return (
    <header className="page-head">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="返回">
          <img src={iconBack} alt="" />
        </button>
      ) : (
        <PetAvatar />
      )}
      {onBack ? <span className="page-head-title">{title}</span> : <span className="page-head-name">{petName}</span>}
      <button className="icon-btn" onClick={closeWindow} aria-label="关闭">
        <img src={iconClose} alt="" />
      </button>
    </header>
  )
}

export function PageFoot() {
  return (
    <footer className="page-foot">
      <span>宠格· 每一场陪伴都值得被看见</span>
      <span>V0.1</span>
    </footer>
  )
}

/** 页壳：页头 + 滚动主体 + 页脚，五页共用 */
export function PageShell(props: {
  title?: string
  petName?: string
  onBack?: () => void
  children: ReactNode
}) {
  return (
    <div className="panel-shell">
      <PageHead title={props.title} petName={props.petName} onBack={props.onBack} />
      <div className="page-body">{props.children}</div>
      <PageFoot />
    </div>
  )
}

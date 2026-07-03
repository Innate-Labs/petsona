// panel/kit.tsx —— 面板通用小件：页壳/页头/页脚/头像（组件库 页头32:4143·页脚32:4008·宠物头像32:4117）
// + 自绘 Modal/Prompt/Confirm：Tauri WKWebView 不实现 window.prompt/confirm/alert（触发即静默失败），
//   面板窗内必须用自绘弹层代替。API 尽量贴近浏览器语义（返回 Promise，取消返回 null/false）。

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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

// ---------- 自绘 Prompt / Confirm ----------
// 为什么不复用浏览器 window.prompt/confirm/alert：
//   Tauri（macOS WKWebView）默认不实现这三个方法，调用会静默返回而不弹层——
//   面板窗任何依赖它们的按钮都会「点了没反应」。挂载 <ModalHost> 后通过 useDialog() 走自绘弹层。

type PromptOpts = { title: string; defaultValue?: string; placeholder?: string; okText?: string; cancelText?: string }
type ConfirmOpts = { title: string; okText?: string; cancelText?: string; danger?: boolean }
type AlertOpts = { title: string; okText?: string }
type DialogApi = {
  prompt: (opts: PromptOpts) => Promise<string | null>
  confirm: (opts: ConfirmOpts) => Promise<boolean>
  alert: (opts: AlertOpts) => Promise<void>
}

const DialogContext = createContext<DialogApi | null>(null)

/** 面板顶层挂 <ModalHost>：提供 useDialog()，同时占位渲染当前弹层 */
export function ModalHost({ children }: { children: ReactNode }) {
  type PendingPrompt = { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  type PendingConfirm = { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  type PendingAlert = { kind: 'alert'; opts: AlertOpts; resolve: () => void }
  type Pending = PendingPrompt | PendingConfirm | PendingAlert

  const [pending, setPending] = useState<Pending | null>(null)

  const api = useMemo<DialogApi>(
    () => ({
      prompt: (opts) => new Promise((resolve) => setPending({ kind: 'prompt', opts, resolve })),
      confirm: (opts) => new Promise((resolve) => setPending({ kind: 'confirm', opts, resolve })),
      alert: (opts) => new Promise((resolve) => setPending({ kind: 'alert', opts, resolve })),
    }),
    [],
  )

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending?.kind === 'prompt' && (
        <PromptDialog
          key={`prompt-${Date.now()}`}
          opts={pending.opts}
          onSubmit={(v) => {
            pending.resolve(v)
            setPending(null)
          }}
        />
      )}
      {pending?.kind === 'confirm' && (
        <ConfirmDialog
          key={`confirm-${Date.now()}`}
          opts={pending.opts}
          onDone={(v) => {
            pending.resolve(v)
            setPending(null)
          }}
        />
      )}
      {pending?.kind === 'alert' && (
        <ConfirmDialog
          key={`alert-${Date.now()}`}
          opts={{ title: pending.opts.title, okText: pending.opts.okText ?? '好' }}
          alertOnly
          onDone={() => {
            pending.resolve()
            setPending(null)
          }}
        />
      )}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog 必须在 <ModalHost> 内使用')
  return ctx
}

/** 遮罩层：ESC 取消 / 点击遮罩取消 */
function ModalScrim({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function PromptDialog({ opts, onSubmit }: { opts: PromptOpts; onSubmit: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.defaultValue ?? '')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    // 弹出立刻聚焦 + 选中默认值，方便直接改写
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <ModalScrim onCancel={() => onSubmit(null)}>
      <p className="modal-title">{opts.title}</p>
      <input
        ref={inputRef}
        value={value}
        placeholder={opts.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit(value)
        }}
      />
      <div className="modal-actions">
        <button className="chip" onClick={() => onSubmit(null)}>
          {opts.cancelText ?? '取消'}
        </button>
        <button className="chip chip--doing" onClick={() => onSubmit(value)}>
          {opts.okText ?? '确定'}
        </button>
      </div>
    </ModalScrim>
  )
}

function ConfirmDialog(props: {
  opts: ConfirmOpts
  alertOnly?: boolean
  onDone: (v: boolean) => void
}) {
  const { opts, alertOnly, onDone } = props
  return (
    <ModalScrim onCancel={() => onDone(false)}>
      {/* 标题里可能带 \n，用 pre-wrap 让换行生效 */}
      <p className="modal-title" style={{ whiteSpace: 'pre-wrap' }}>
        {opts.title}
      </p>
      <div className="modal-actions">
        {!alertOnly && (
          <button className="chip" onClick={() => onDone(false)}>
            {opts.cancelText ?? '取消'}
          </button>
        )}
        <button
          className={`chip ${opts.danger ? 'chip--off' : 'chip--doing'}`}
          onClick={() => onDone(true)}
          autoFocus
        >
          {opts.okText ?? '确定'}
        </button>
      </div>
    </ModalScrim>
  )
}

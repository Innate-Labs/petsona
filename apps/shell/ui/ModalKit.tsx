// ModalKit.tsx —— 当前主面板通用自绘弹层。
// Tauri WKWebView 不实现 window.prompt/confirm/alert，面板内弹层必须走这里。

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type PromptOpts = {
  title: string
  defaultValue?: string
  placeholder?: string
  okText?: string
  cancelText?: string
  options?: string[]
  inputType?: 'text' | 'number' | 'date' | 'time'
  suggestions?: string[]
}
type ConfirmOpts = { title: string; okText?: string; cancelText?: string; danger?: boolean }
type AlertOpts = { title: string; okText?: string }
type DialogApi = {
  prompt: (opts: PromptOpts) => Promise<string | null>
  confirm: (opts: ConfirmOpts) => Promise<boolean>
  alert: (opts: AlertOpts) => Promise<void>
}

const DialogContext = createContext<DialogApi | null>(null)

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
  const [value, setValue] = useState(() => {
    if (opts.options?.length) return opts.defaultValue && opts.options.includes(opts.defaultValue) ? opts.defaultValue : opts.options[0]!
    return opts.defaultValue ?? ''
  })
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const listId = opts.suggestions?.length ? 'prompt-suggestions' : undefined
  return (
    <ModalScrim onCancel={() => onSubmit(null)}>
      <p className="modal-title">{opts.title}</p>
      {opts.options?.length ? (
        <select value={value} autoFocus onChange={(e) => setValue(e.target.value)}>
          {opts.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <>
          <input
            ref={inputRef}
            type={opts.inputType ?? 'text'}
            step={opts.inputType === 'number' ? '0.1' : undefined}
            list={listId}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit(value)
            }}
          />
          {listId && (
            <datalist id={listId}>
              {opts.suggestions!.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
      <div className="modal-actions">
        <button className="chip" onClick={() => onSubmit(null)}>{opts.cancelText ?? '取消'}</button>
        <button className="chip chip--doing" onClick={() => onSubmit(value)}>{opts.okText ?? '确定'}</button>
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
      <p className="modal-title" style={{ whiteSpace: 'pre-wrap' }}>{opts.title}</p>
      <div className="modal-actions">
        {!alertOnly && <button className="chip" onClick={() => onDone(false)}>{opts.cancelText ?? '取消'}</button>}
        <button className={`chip ${opts.danger ? 'chip--off' : 'chip--doing'}`} onClick={() => onDone(true)} autoFocus>
          {opts.okText ?? '确定'}
        </button>
      </div>
    </ModalScrim>
  )
}

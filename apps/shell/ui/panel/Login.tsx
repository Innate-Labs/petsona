// panel/Login.tsx —— 邮箱验证码登录（§4 登录行；桌面强制登录 §0）
// 流程：邮箱 → LOGIN_REQUEST_CODE → 验证码 → LOGIN_SUBMIT → 等 AUTH_STATE_CHANGED 广播。
// 为什么成功态不在本组件收尾：登录态门控在 Panel，广播一到自动切主界面。

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { AuthStateChangedPayload, LoginRequestCodePayload, LoginSubmitPayload } from '@petsona/shared'
import { IpcError, on, request } from '../lib/ipc'
import { CHARACTER } from '../lib/character'

export function Login() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(
    () =>
      on<AuthStateChangedPayload>(IPC.AUTH_STATE_CHANGED, (p) => {
        // 只负责收尾 loading；错误码文案化交给 harness，这里不猜失败原因
        if (p.loginState === 'logged_in') setBusy(false)
      }),
    [],
  )

  const requestCode = () => {
    const em = email.trim()
    if (!em.includes('@')) {
      setErr('邮箱格式不对')
      return
    }
    setBusy(true)
    setErr('')
    const payload: LoginRequestCodePayload = { email: em }
    void request(IPC.LOGIN_REQUEST_CODE, payload)
      .then(() => setStep('code'))
      .catch((e: unknown) => setErr(e instanceof IpcError ? `发送失败：${e.code}` : '发送失败'))
      .finally(() => setBusy(false))
  }

  const submit = () => {
    if (!code.trim()) return
    setBusy(true)
    setErr('')
    const payload: LoginSubmitPayload = { email: email.trim(), code: code.trim() }
    void request(IPC.LOGIN_SUBMIT, payload).catch((e: unknown) => {
      setErr(e instanceof IpcError ? `登录失败：${e.code}` : '登录失败')
      setBusy(false)
    })
  }

  return (
    <div className="login">
      <img className="login-face" src={CHARACTER.avatar} alt="宠物" style={{ borderRadius: 999 }} />
      <h1>宠格 Petsona</h1>
      <p className="login-hint">先登录，宠物才能记住你哦</p>
      {step === 'email' ? (
        <div className="login-form">
          <input
            type="email"
            value={email}
            placeholder="邮箱"
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') requestCode()
            }}
          />
          <button disabled={busy} onClick={requestCode}>
            {busy ? '发送中…' : '发送验证码'}
          </button>
        </div>
      ) : (
        <div className="login-form">
          <p className="login-hint">验证码已发到 {email.trim()}</p>
          <input
            value={code}
            placeholder="6 位验证码"
            disabled={busy}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button disabled={busy} onClick={submit}>
            {busy ? '登录中…' : '登录'}
          </button>
          <button className="link" disabled={busy} onClick={() => setStep('email')}>
            换个邮箱
          </button>
        </div>
      )}
      {err && <p className="login-err">{err}</p>}
    </div>
  )
}

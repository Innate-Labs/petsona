// panel/Login.tsx —— 邮箱 + 密码单步登录（桌面 M1 简化流；替换 v2.1 验证码流）
// 流程：邮箱 + 密码 → LOGIN_SUBMIT（password 路径）→ 等 AUTH_STATE_CHANGED 广播。
// 首次登录即注册（后端不存在 user 时自动创建 + 存密码 hash）。
// 为什么改单步：桌面暂无邮件服务，验证码发不出去；密码流去掉发送环节，本地即可用。

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { AuthStateChangedPayload, LoginSubmitPayload } from '@petsona/shared'
import { IpcError, on, request } from '../lib/ipc'
import { CHARACTER } from '../lib/character'

const MIN_PASSWORD = 6   // SPEC-GAP: 规格未给密码强度，取常见最低门槛

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  const submit = () => {
    const em = email.trim()
    const pw = password
    if (!em.includes('@')) { setErr('邮箱格式不对'); return }
    if (pw.length < MIN_PASSWORD) { setErr(`密码至少 ${MIN_PASSWORD} 位`); return }
    setBusy(true)
    setErr('')
    const payload: LoginSubmitPayload = { email: em, password: pw }
    void request(IPC.LOGIN_SUBMIT, payload).catch((e: unknown) => {
      setErr(e instanceof IpcError ? `登录失败：${e.code}` : '登录失败')
      setBusy(false)
    })
  }

  return (
    <div className="login">
      <img className="login-face" src={CHARACTER.avatar} alt="宠物" style={{ borderRadius: 999 }} />
      <h1>宠格 Petsona</h1>
      <p className="login-hint">用邮箱 + 密码登录，首次填即注册</p>
      <div className="login-form">
        <input
          type="email"
          value={email}
          placeholder="邮箱"
          disabled={busy}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <input
          type="password"
          value={password}
          placeholder={`密码（至少 ${MIN_PASSWORD} 位）`}
          disabled={busy}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button disabled={busy} onClick={submit}>
          {busy ? '登录中…' : '登录 / 注册'}
        </button>
      </div>
      {err && <p className="login-err">{err}</p>}
    </div>
  )
}

// panel/Settings.tsx —— 面向普通用户的设置中心
// 分区：AI 模型 Key（BYOK）/ 陪伴节奏 / 文件权限 / 账号 / 快捷入口 / 进阶（折叠）
// 为什么把 API Key 放最上：真机验证时用户第一次进设置的核心动作是「填自己的 key」；
// gatewayUrl 等运维字段沉进「进阶」折叠，避免小白被吓到。

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type {
  AuthStateChangedPayload, Config, ConfigGetRes, ConfigSetPayload,
  LlmKeyGetRes, LlmKeySetPayload, ProactiveFrequency,
} from '@petsona/shared'
import { IpcError, request } from '../lib/ipc'

// 面向用户的友好文案（原 v→label 只在开发者视角有意义）
const FREQ_LABEL: Array<{ v: ProactiveFrequency; label: string; hint: string }> = [
  { v: 'high', label: '常来', hint: '每 15 分钟左右可能过来打招呼' },
  { v: 'mid', label: '适中', hint: '每 45 分钟左右一次（推荐）' },
  { v: 'low', label: '偶尔', hint: '约 2 小时一次' },
  { v: 'off', label: '不主动', hint: '只在你主动喊我时才出现' },
]

export function Settings() {
  const [loaded, setLoaded] = useState(false)
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [scopesText, setScopesText] = useState('')
  const [freq, setFreq] = useState<ProactiveFrequency>('mid')
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('09:00')
  const [mute, setMute] = useState(true)
  const [note, setNote] = useState('')

  // BYOK：LLM_KEY_GET 只回 hasKey + maskedTail；输入框保持空，用户重填才 SET
  const [keyMeta, setKeyMeta] = useState<LlmKeyGetRes>({ hasKey: false })
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keyNote, setKeyNote] = useState('')

  // 账号：显示当前登录邮箱
  const [auth, setAuth] = useState<AuthStateChangedPayload>({ loginState: 'anon' })
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    void request<ConfigGetRes>(IPC.CONFIG_GET, {})
      .then(({ config }) => {
        setGatewayUrl(config.gatewayUrl)
        setScopesText(config.scopes.join('\n'))
        setFreq(config.proactive.frequency)
        setQuietStart(config.proactive.quietHours[0])
        setQuietEnd(config.proactive.quietHours[1])
        setMute(config.proactive.fullscreenMute)
        setLoaded(true)
      })
      .catch((e: unknown) => setNote(e instanceof IpcError ? `配置加载失败：${e.code}` : '配置加载失败'))
    void request<LlmKeyGetRes>(IPC.LLM_KEY_GET, {}).then(setKeyMeta).catch(() => {})
    void request<AuthStateChangedPayload>(IPC.AUTH_STATE_GET, {}).then(setAuth).catch(() => {})
  }, [])

  const save = () => {
    // 为什么整段覆盖 proactive：CONFIG_SET 语义是 Partial<Config> 浅合并，嵌套字段拆开发会丢
    const patch: Partial<Config> = {
      gatewayUrl: gatewayUrl.trim(),
      scopes: scopesText.split('\n').map((s) => s.trim()).filter(Boolean),
      proactive: { frequency: freq, quietHours: [quietStart, quietEnd], fullscreenMute: mute },
    }
    const payload: ConfigSetPayload = { patch }
    void request(IPC.CONFIG_SET, payload)
      .then(() => setNote('已保存'))
      .catch((e: unknown) => setNote(e instanceof IpcError ? `保存失败：${e.code}` : '保存失败'))
  }

  const saveKey = () => {
    const key = apiKeyInput.trim()
    if (!key) { setKeyNote('请先粘贴 key'); return }
    const payload: LlmKeySetPayload = { key }
    void request<LlmKeyGetRes>(IPC.LLM_KEY_SET, payload)
      .then((res) => { setKeyMeta(res); setApiKeyInput(''); setKeyNote('已保存到本地 Keychain') })
      .catch((e: unknown) => setKeyNote(e instanceof IpcError ? `保存失败：${e.code}` : '保存失败'))
  }

  const clearKey = () => {
    void request<LlmKeyGetRes>(IPC.LLM_KEY_CLEAR, {})
      .then((res) => { setKeyMeta(res); setKeyNote('已清除，将回落到内置 key') })
      .catch(() => setKeyNote('清除失败'))
  }

  const logout = () => {
    // 登出后 harness 广播 AUTH_STATE_CHANGED(anon)，Panel 门控自动切回登录页
    void request(IPC.LOGOUT, {}).catch(() => {})
  }

  if (!loaded && !note) return <div className="placeholder">配置加载中…</div>

  return (
    <div className="settings">
      {/* —— 1. AI 模型 Key —— */}
      <section className="settings-section">
        <h3>AI 模型密钥</h3>
        <p className="settings-hint">目前仅支持 DeepSeek，其它模型后续开放。</p>
        <div className="settings-key-status">
          {keyMeta.hasKey ? (
            <span>当前使用：<b>你自己的 key</b>（末四位 <code>****{keyMeta.maskedTail}</code>）</span>
          ) : (
            <span>当前使用：<b>内置默认 key</b>（可能有额度限制，建议填自己的）</span>
          )}
        </div>
        <label className="field">
          <span>DeepSeek API Key（在 platform.deepseek.com 领取）</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-..."
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
          />
        </label>
        <div className="settings-actions">
          <button onClick={saveKey} disabled={!apiKeyInput.trim()}>保存 key</button>
          <button className="ghost" onClick={clearKey} disabled={!keyMeta.hasKey}>清除</button>
        </div>
        {keyNote && <p className="settings-note">{keyNote}</p>}
        <p className="settings-hint">密钥只存到 macOS Keychain，不会同步到云端。</p>
      </section>

      {/* —— 2. 陪伴节奏 —— */}
      <section className="settings-section">
        <h3>陪伴节奏</h3>
        <label className="field">
          <span>多久主动找我一次</span>
          <select value={freq} onChange={(e) => setFreq(e.target.value as ProactiveFrequency)}>
            {FREQ_LABEL.map((f) => (
              <option key={f.v} value={f.v}>{f.label} · {f.hint}</option>
            ))}
          </select>
        </label>
        <div className="field field--row">
          <span>不打扰时段</span>
          <input className="narrow" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
          <span>到</span>
          <input className="narrow" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
        </div>
        <p className="settings-hint">这段时间内宠物不会主动出现。</p>
        <label className="field field--row">
          <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
          <span>我在全屏工作/看视频时保持安静</span>
        </label>
      </section>

      {/* —— 3. 文件权限 —— */}
      <section className="settings-section">
        <h3>文件权限</h3>
        <label className="field">
          <span>宠物可以整理的文件夹（每行一个）</span>
          <textarea rows={3} value={scopesText} onChange={(e) => setScopesText(e.target.value)} />
        </label>
        <p className="settings-hint">宠物只会在这些文件夹里读写文件；其它位置一律拒绝。</p>
      </section>

      {/* —— 4. 账号 —— */}
      <section className="settings-section">
        <h3>账号</h3>
        <p className="settings-hint">
          {auth.loginState === 'logged_in'
            ? <>已登录：<b>{auth.email ?? '（未知邮箱）'}</b></>
            : '未登录'}
        </p>
        <div className="settings-actions">
          <button className="danger" onClick={logout} disabled={auth.loginState !== 'logged_in'}>
            退出登录
          </button>
        </div>
      </section>

      {/* —— 5. 快捷入口 —— */}
      <section className="settings-section">
        <h3>其它</h3>
        <div className="settings-actions">
          <button onClick={() => { window.location.hash = '#/panel/approval' }}>审批与撤销</button>
          <button onClick={() => { window.location.hash = '#/panel/memory' }}>记忆管理</button>
        </div>
      </section>

      {/* —— 6. 进阶（默认折叠；给运维/开发者留口） —— */}
      <section className="settings-section">
        <button className="settings-toggle" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? '▾' : '▸'} 进阶设置
        </button>
        {showAdvanced && (
          <label className="field">
            <span>网关地址（gatewayUrl）—— 一般不用改</span>
            <input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} />
          </label>
        )}
      </section>

      <div className="settings-actions settings-actions--footer">
        <button onClick={save} disabled={!loaded}>保存设置</button>
      </div>
      {note && <p className="settings-note">{note}</p>}
    </div>
  )
}

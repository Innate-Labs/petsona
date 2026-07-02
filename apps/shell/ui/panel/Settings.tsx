// panel/Settings.tsx —— 设置骨架（M1 只求可用）：CONFIG_GET 展示 / CONFIG_SET 保存

import { useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { Config, ConfigGetRes, ConfigSetPayload, ProactiveFrequency } from '@petsona/shared'
import { IpcError, request } from '../lib/ipc'

const FREQS: Array<{ v: ProactiveFrequency; label: string }> = [
  { v: 'high', label: '高（≥15min）' },
  { v: 'mid', label: '中（≥45min）' },
  { v: 'low', label: '低（≥120min）' },
  { v: 'off', label: '关闭' },
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
  }, [])

  const save = () => {
    // 为什么整段覆盖 proactive：CONFIG_SET 语义是 Partial<Config> 浅合并，嵌套字段拆开发会丢
    const patch: Partial<Config> = {
      gatewayUrl: gatewayUrl.trim(),
      scopes: scopesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      proactive: { frequency: freq, quietHours: [quietStart, quietEnd], fullscreenMute: mute },
    }
    const payload: ConfigSetPayload = { patch }
    void request(IPC.CONFIG_SET, payload)
      .then(() => setNote('已保存'))
      .catch((e: unknown) => setNote(e instanceof IpcError ? `保存失败：${e.code}` : '保存失败'))
  }

  const logout = () => {
    // 登出后 harness 广播 AUTH_STATE_CHANGED(anon)，Panel 门控自动切回登录页
    void request(IPC.LOGOUT, {}).catch(() => {})
  }

  if (!loaded && !note) return <div className="placeholder">配置加载中…</div>

  return (
    <div className="settings">
      <h2>设置</h2>
      <label className="field">
        <span>网关地址 gatewayUrl</span>
        <input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} />
      </label>
      <label className="field">
        <span>授权目录 scopes（每行一个）</span>
        <textarea rows={4} value={scopesText} onChange={(e) => setScopesText(e.target.value)} />
      </label>
      <label className="field">
        <span>主动陪伴频率</span>
        <select value={freq} onChange={(e) => setFreq(e.target.value as ProactiveFrequency)}>
          {FREQS.map((f) => (
            <option key={f.v} value={f.v}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field field--row">
        <span>免打扰时段</span>
        <input className="narrow" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
        <span>至</span>
        <input className="narrow" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
      </div>
      <label className="field field--row">
        <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
        <span>全屏应用时静默</span>
      </label>
      <div className="field">
        <span>任务审批</span>
        {/* Panel 深链注释承诺的「设置中心入口」：审批/记忆页不在首页四卡里，从这里进 */}
        <div className="settings-actions">
          <button onClick={() => { window.location.hash = '#/panel/approval' }}>审批与撤销</button>
          <button onClick={() => { window.location.hash = '#/panel/memory' }}>记忆管理</button>
        </div>
      </div>
      <div className="settings-actions">
        <button onClick={save} disabled={!loaded}>
          保存
        </button>
        <button className="danger" onClick={logout}>
          退出登录
        </button>
      </div>
      {note && <p className="settings-note">{note}</p>}
    </div>
  )
}

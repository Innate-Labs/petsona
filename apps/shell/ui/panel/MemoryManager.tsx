// panel/MemoryManager.tsx —— 记忆管理页（规格功能表 P1·M3）：「宠物记得我什么」分类视图
// source=settings 可编辑，其余只读（MEMORY_EDIT 由 harness 强制，UI 只是不给入口）；删除即时生效。
// 编辑要完整 body，LIST 只回 40 字 gist → 先 MEMORY_GET 再 prompt（协议增补见 SPEC-GAPS H25）。

import { useCallback, useEffect, useState } from 'react'
import { IPC } from '@petsona/shared'
import type { ColdItemMeta, ColdType, MemoryGetRes, MemoryListGetRes } from '@petsona/shared'
import { request } from '../lib/ipc'
import { useDialog } from './kit'

const TYPE_TABS: { key: ColdType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'preference', label: '偏好' },
  { key: 'fact', label: '事实' },
  { key: 'emotion', label: '情绪' },
  { key: 'profile', label: '画像' },
  { key: 'meme', label: '梗' },
]

const SOURCE_LABEL: Record<ColdItemMeta['source'], string> = {
  settings: '手动',
  chat: '聊天',
  system: '整理',
}

export function MemoryManager() {
  const [tab, setTab] = useState<ColdType | 'all'>('all')
  const [items, setItems] = useState<ColdItemMeta[]>([])
  const [note, setNote] = useState('')
  const dialog = useDialog()

  const reload = useCallback((t: ColdType | 'all') => {
    void request<MemoryListGetRes>(IPC.MEMORY_LIST_GET, t === 'all' ? {} : { type: t })
      .then((res) => setItems(res.items ?? []))
      .catch(() => setItems([]))
  }, [])

  useEffect(() => reload(tab), [tab, reload])

  const del = (name: string) => {
    void dialog.confirm({ title: `删掉这条记忆？\n${name}`, danger: true, okText: '删除' }).then((ok) => {
      if (!ok) return
      void request(IPC.MEMORY_DELETE, { name })
        .then(() => reload(tab))
        .catch((e) => setNote(`删除失败：${e instanceof Error ? e.message : e}`))
    })
  }

  const edit = (name: string) => {
    // 先拉全文再编辑：gist 是 40 字截断，直接改会丢内容
    void request<MemoryGetRes>(IPC.MEMORY_GET, { name })
      .then(({ item }) =>
        dialog.prompt({ title: '编辑记忆内容', defaultValue: item.body }).then((body) => {
          if (body === null || body.trim() === '' || body === item.body) return
          return request(IPC.MEMORY_EDIT, { name, body: body.trim() }).then(() => reload(tab))
        }),
      )
      .catch((e) => setNote(`编辑失败：${e instanceof Error ? e.message : e}`))
  }

  const clear = () => {
    const scopeLabel = TYPE_TABS.find((t) => t.key === tab)!.label
    void dialog
      .confirm({ title: `清空「${scopeLabel}」分类下的全部记忆？此操作即时生效。`, danger: true, okText: '清空' })
      .then((ok) => {
        if (!ok) return
        void request(IPC.MEMORY_CLEAR, { scope: tab === 'all' ? 'all' : tab })
          .then(() => reload(tab))
          .catch((e) => setNote(`清空失败：${e instanceof Error ? e.message : e}`))
      })
  }

  return (
    <>
      <div className="remind-card-chips" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
        {TYPE_TABS.map((t) => (
          <button key={t.key} className={`chip ${tab === t.key ? 'chip--doing' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {items.map((m) => (
        <div key={m.name} className="row">
          <span className="row-title" title={`${m.name} · ${m.topic}`}>
            {m.gist || m.name}
          </span>
          <span className="chip chip--off">{SOURCE_LABEL[m.source] ?? m.source}</span>
          <span className="row-time">{m.lastT.slice(0, 10)}</span>
          {m.source === 'settings' && (
            <button className="chip" onClick={() => edit(m.name)}>
              改
            </button>
          )}
          <button className="row-del" onClick={() => del(m.name)} aria-label={`删除 ${m.name}`}>
            ✕
          </button>
        </div>
      ))}
      {items.length === 0 && <div className="placeholder">这个分类下还没有记忆～多聊聊我就记住啦</div>}

      {items.length > 0 && (
        <div className="section-head" style={{ marginTop: 12 }}>
          <button className="chip chip--off" onClick={clear}>
            清空{tab === 'all' ? '全部' : '本分类'}
          </button>
        </div>
      )}
      {note && <div className="float-tooling" style={{ padding: '8px' }}>{note}</div>}
    </>
  )
}

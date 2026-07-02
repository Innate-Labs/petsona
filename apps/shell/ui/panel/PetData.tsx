// panel/PetData.tsx —— 宠物数据页（Figma 82:2065）：可编辑头像行 + 数据面板 + 长按钮
// SPEC-GAP: 档案暂存 localStorage（lib/local.ts），M2 迁 $DATA 经 harness。

import { useState } from 'react'
import { loadProfile, saveProfile } from '../lib/local'
import type { PetProfile } from '../lib/local'
import { PetAvatar } from './kit'
import iconEdit from '../assets/figma/icon-edit-18.svg'
import iconRow from '../assets/figma/icon-row-28.svg'
import iconChevron from '../assets/figma/icon-chevron-12.svg'

const SPECIES = ['小猫', '小狗', '仓鼠', '兔子']
const PERSONALITIES = ['温柔', '高冷', '活泼', '粘人']

type RowDef = { key: keyof PetProfile; label: string; options?: string[] }

const ROWS: RowDef[] = [
  { key: 'species', label: '宠物种类', options: SPECIES },
  { key: 'personality', label: '性格', options: PERSONALITIES },
  { key: 'breed', label: '品种' },
  { key: 'age', label: '年龄' },
  { key: 'weight', label: '体重' },
  { key: 'deworm', label: '上次驱虫' },
  { key: 'vaccine', label: '上次疫苗' },
]

export function PetData() {
  const [profile, setProfile] = useState(loadProfile)

  const update = (patch: Partial<PetProfile>) => {
    const next = { ...profile, ...patch }
    setProfile(next)
    saveProfile(next)
  }

  // 下拉 chip 点击轮换选项：M1 无自定义下拉控件，轮换即满足「可改」；原生 select 破坏视觉
  const cycle = (row: RowDef) => {
    if (!row.options) return
    const cur = profile[row.key] as string
    const i = row.options.indexOf(cur)
    update({ [row.key]: row.options[(i + 1) % row.options.length] } as Partial<PetProfile>)
  }

  const rename = () => {
    const name = window.prompt('给宠物起个新名字', profile.name)
    if (name?.trim()) update({ name: name.trim() })
  }

  const editValue = (row: RowDef) => {
    if (row.options) return cycle(row)
    const v = window.prompt(row.label, profile[row.key] as string)
    if (v?.trim()) update({ [row.key]: v.trim() } as Partial<PetProfile>)
  }

  return (
    <>
      <div className="petdata-id">
        <PetAvatar size={50} />
        <div>
          <div className="petdata-name">
            昵称: {profile.name}
            <img src={iconEdit} alt="改名" onClick={rename} />
          </div>
          <div className="petdata-no">宠宠号: {profile.petNo}</div>
        </div>
      </div>
      <div className="data-panel">
        {ROWS.map((row) => (
          <div className="data-row" key={row.key}>
            <img src={iconRow} alt="" />
            <span className="data-row-label">{row.label}</span>
            {row.options ? (
              <button className="drop-chip" onClick={() => cycle(row)}>
                {profile[row.key] as string}
                <img src={iconChevron} alt="" />
              </button>
            ) : (
              <span className="data-row-value" onDoubleClick={() => editValue(row)}>
                {profile[row.key] as string}
              </span>
            )}
          </div>
        ))}
      </div>
      {/* 形象上传：正式美术资产 M2（v3.0 A.4），先给可点反馈不做假上传 */}
      <button className="long-btn" onClick={() => window.alert('宠物形象上传在 M2 和正式美术一起交付喵～')}>
        重新上传宠物形象
      </button>
    </>
  )
}

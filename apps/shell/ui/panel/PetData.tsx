// panel/PetData.tsx —— 宠物数据页（Figma 82:2065）：记录主人家真实宠物的档案，全字段可编辑
// 第四轮真机验收修订：种类/性格 = 行内原生下拉；品种 = 按种类常见选项 + 可自填（datalist）；
// 年龄 = 常用建议 + 可自填；体重 = 数字输入；驱虫/疫苗 = 原生日期选择器；所有行单击即编辑。
// SPEC-GAP: 档案暂存 localStorage（lib/local.ts），M2 迁 $DATA 经 harness。

import { useState } from 'react'
import { loadProfile, saveProfile } from '../lib/local'
import type { PetProfile } from '../lib/local'
import { PetAvatar, useDialog } from './kit'
import iconEdit from '../assets/figma/icon-edit-18.svg'
import iconRow from '../assets/figma/icon-row-28.svg'
import iconChevron from '../assets/figma/icon-chevron-12.svg'

const SPECIES = ['小猫', '小狗', '仓鼠', '兔子']
const PERSONALITIES = ['温柔', '高冷', '活泼', '粘人']

// 按种类给常见品种（datalist 建议，允许自填冷门品种）
const BREEDS: Record<string, string[]> = {
  小猫: ['布偶猫', '英短', '美短', '橘猫', '狸花猫', '暹罗猫', '缅因猫'],
  小狗: ['柯基', '金毛', '泰迪', '柴犬', '边牧', '萨摩耶', '哈士奇'],
  仓鼠: ['金丝熊', '三线仓鼠', '布丁仓鼠', '银狐仓鼠'],
  兔子: ['垂耳兔', '侏儒兔', '安哥拉兔', '狮子兔'],
}

const AGE_SUGGESTIONS = ['3月', '6月', '1岁', '1岁6月', '2岁', '2岁3月', '3岁', '5岁', '8岁', '10岁']

/** '2026/6/28' → '2026-06-28'（input[type=date] 要求补零 ISO 格式）；解析失败返回空让控件自选 */
function toDateInput(v: string): string {
  const m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return ''
  return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
}

/** '2026-06-28' → '2026/6/28'（沿用档案既有的不补零展示格式） */
function fromDateInput(v: string): string | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`
}

type RowDef = { key: keyof PetProfile; label: string; kind: 'select' | 'breed' | 'age' | 'weight' | 'date' }

const ROWS: RowDef[] = [
  { key: 'species', label: '宠物种类', kind: 'select' },
  { key: 'personality', label: '性格', kind: 'select' },
  { key: 'breed', label: '品种', kind: 'breed' },
  { key: 'age', label: '年龄', kind: 'age' },
  { key: 'weight', label: '体重', kind: 'weight' },
  { key: 'deworm', label: '上次驱虫', kind: 'date' },
  { key: 'vaccine', label: '上次疫苗', kind: 'date' },
]

export function PetData() {
  const [profile, setProfile] = useState(loadProfile)
  const dialog = useDialog()

  const update = (patch: Partial<PetProfile>) => {
    const next = { ...profile, ...patch }
    setProfile(next)
    saveProfile(next)
  }

  const rename = () => {
    void dialog.prompt({ title: '给宠物起个新名字', defaultValue: profile.name }).then((name) => {
      if (name?.trim()) update({ name: name.trim() })
    })
  }

  const editValue = (row: RowDef) => {
    const cur = profile[row.key] as string
    if (row.kind === 'breed') {
      void dialog
        .prompt({
          title: `品种（${profile.species}常见的可以直接挑）`,
          defaultValue: cur,
          suggestions: BREEDS[profile.species] ?? Object.values(BREEDS).flat(),
        })
        .then((v) => {
          if (v?.trim()) update({ breed: v.trim() })
        })
    } else if (row.kind === 'age') {
      void dialog
        .prompt({ title: '年龄（如 2岁3月）', defaultValue: cur, suggestions: AGE_SUGGESTIONS })
        .then((v) => {
          if (v?.trim()) update({ age: v.trim() })
        })
    } else if (row.kind === 'weight') {
      void dialog
        .prompt({
          title: '体重（千克）',
          inputType: 'number',
          defaultValue: String(Number.parseFloat(cur) || ''),
          placeholder: '7.8',
        })
        .then((v) => {
          const n = Number.parseFloat(v ?? '')
          if (Number.isFinite(n) && n > 0) update({ weight: `${n}千克` })
        })
    } else if (row.kind === 'date') {
      void dialog
        .prompt({ title: row.label, inputType: 'date', defaultValue: toDateInput(cur) })
        .then((v) => {
          const d = v && fromDateInput(v)
          if (d) update({ [row.key]: d } as Partial<PetProfile>)
        })
    }
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
            {row.kind === 'select' ? (
              <span className="drop-chip drop-chip--select">
                <select
                  value={profile[row.key] as string}
                  aria-label={row.label}
                  onChange={(e) => update({ [row.key]: e.target.value } as Partial<PetProfile>)}
                >
                  {(row.key === 'species' ? SPECIES : PERSONALITIES).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <img src={iconChevron} alt="" />
              </span>
            ) : (
              <button className="data-row-btn" title="点击修改" onClick={() => editValue(row)}>
                {profile[row.key] as string}
                <img src={iconEdit} alt="" />
              </button>
            )}
          </div>
        ))}
      </div>
      {/* 形象上传：正式美术资产 M2（v3.0 A.4），先给可点反馈不做假上传 */}
      <button
        className="long-btn"
        onClick={() => void dialog.alert({ title: '宠物形象上传在 M2 和正式美术一起交付喵～' })}
      >
        重新上传宠物形象
      </button>
    </>
  )
}

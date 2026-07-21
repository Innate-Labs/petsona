// Dropdown.tsx —— 自绘下拉框（全项目统一替代原生 <select>）
// 为什么自绘：WKWebView 里原生 select 的弹出菜单是系统控件，无法贴合面板米棕视觉；
// 自绘为 DOM 浮层（button + listbox），不涉及面板弹层红线（那条只禁 window.prompt/confirm/alert）。

import React, { useEffect, useRef, useState } from 'react'

export type DropdownOption<Value extends string = string> = {
  value: Value
  label: string
  hint?: string // 选项内的次要说明（如档位时间），只在展开的菜单里显示
}

// 预估菜单高度用于向上/向下翻转判断（选项高 ~34px + hint 行 ~15px + 内边距）
const MENU_MAX_HEIGHT = 264

export function Dropdown<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: Value
  options: ReadonlyArray<DropdownOption<Value>>
  onChange: (value: Value) => void
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const toggle = () => {
    const bounds = rootRef.current?.getBoundingClientRect()
    if (bounds) {
      // 在滚动容器（settings-content / pet-data-content）内可能被裁剪：下方空间不足且上方更宽裕时向上开
      const below = window.innerHeight - bounds.bottom
      setUpward(below < MENU_MAX_HEIGHT && bounds.top > below)
    }
    setOpen((current) => !current)
  }

  const current = options.find((option) => option.value === value)

  return (
    <div className={className ? `ui-dropdown ${className}` : 'ui-dropdown'} ref={rootRef}>
      <button
        type="button"
        className={open ? 'ui-dropdown-trigger open' : 'ui-dropdown-trigger'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
      >
        <span className="ui-dropdown-value">{current?.label ?? value}</span>
        <svg className="ui-dropdown-caret" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul className={upward ? 'ui-dropdown-menu upward' : 'ui-dropdown-menu'} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? 'ui-dropdown-option selected' : 'ui-dropdown-option'}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span>{option.label}</span>
                {option.hint ? <small>{option.hint}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

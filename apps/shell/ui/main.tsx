// main.tsx —— 窗口级 hash 路由：#/pet 宠物窗 / #/float 对话浮窗 / #/panel 面板窗（默认）
// 为什么用 hash 而非 router 库：入口只有窗口数个，引路由库纯属浪费体积。

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PetWindow } from './pet/PetWindow'
import { FloatChat } from './float/FloatChat'
import { Panel } from './panel/Panel'
import './styles.css'

type Route = 'pet' | 'float' | 'panel'

const routeFromHash = (): Route =>
  window.location.hash.startsWith('#/pet') ? 'pet' : window.location.hash.startsWith('#/float') ? 'float' : 'panel'

function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    // 为什么标在 body：宠物窗要全透明背景（NSPanel 悬浮），面板窗要深色底，CSS 按 data-route 分流
    document.body.dataset.route = route
  }, [route])

  return route === 'pet' ? <PetWindow /> : route === 'float' ? <FloatChat /> : <Panel />
}

createRoot(document.getElementById('root')!).render(<App />)

// main.tsx —— 双入口 hash 路由：#/pet 宠物窗 / #/panel 面板窗（默认）
// 为什么用 hash 而非 router 库：只有两个窗口级入口，引路由库纯属浪费体积。

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PetWindow } from './pet/PetWindow'
import { Panel } from './panel/Panel'
import './styles.css'

type Route = 'pet' | 'panel'

const routeFromHash = (): Route => (window.location.hash.startsWith('#/pet') ? 'pet' : 'panel')

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

  return route === 'pet' ? <PetWindow /> : <Panel />
}

createRoot(document.getElementById('root')!).render(<App />)

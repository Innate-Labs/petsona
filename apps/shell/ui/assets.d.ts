// 静态资产模块声明：vite 把图片 import 解析为 URL 字符串
declare module '*.png' {
  const url: string
  export default url
}

declare module '*.svg' {
  const url: string
  export default url
}

declare module '*.webm' {
  const url: string
  export default url
}

declare module '*.mov' {
  const url: string
  export default url
}

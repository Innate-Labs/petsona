// 通用 HTTP 错误 envelope（v2.1 §3.3.1：所有端点 4xx/5xx 统一 {error:{code,message}}，message 为可直接展示的中文）

export function errBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } }
}

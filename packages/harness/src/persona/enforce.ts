// persona_enforce（PostLLM 首位 hook）——人格强制卡
// M1 stub：链路必须走通（v3.0 A.3），仅做基础清洗；正式一致性检查随评测集在 M3 收紧

export function personaEnforce(text: string): string {
  // SPEC-GAP: M1 stub——剥掉模型可能带出的系统标记/角色前缀，防止串戏式输出直达用户
  return text
    .replace(/^(assistant|系统|System)[:：]\s*/i, '')
    .replace(/<\/?(system|thinking)>/g, '')
    .trim()
}

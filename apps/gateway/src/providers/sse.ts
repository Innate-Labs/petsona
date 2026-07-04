// 上游 SSE 流解析（openai_compat / anthropic 共用）
// 为什么手写而不引依赖：硬约束「不用 vendor SDK、零新依赖」，Node 22 全局 fetch 的
// body 是 Web ReadableStream，逐行切帧即可满足两家上游的 event-stream 语法子集。

export type SseFrame = { event: string; data: string }

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let event = ''
  let dataLines: string[] = []

  const flush = (): SseFrame | null => {
    if (dataLines.length === 0) return null
    const frame = { event, data: dataLines.join('\n') }
    event = ''
    dataLines = []
    return frame
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      // 按行处理；空行 = 帧结束（SSE 规范）
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line === '') {
          const f = flush()
          if (f) yield f
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
        // 其余（: 注释 / id: / retry:）忽略
      }
    }
    const f = flush()
    if (f) yield f
  } finally {
    reader.releaseLock()
  }
}

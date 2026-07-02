// e2e 测试助手：spawn 真实 harness 进程，NDJSON 收发 Envelope

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const HARNESS_MAIN = join(ROOT, 'packages/harness/dist/main.js')

type Env = Record<string, string>

export class HarnessProc {
  private proc: ChildProcess
  private listeners: ((env: any) => void)[] = []
  received: any[] = []

  constructor(env: Env) {
    this.proc = spawn('node', [HARNESS_MAIN], {
      env: { ...process.env, PETSONA_KEYCHAIN: 'memory', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const rl = createInterface({ input: this.proc.stdout! })
    rl.on('line', (line) => {
      try {
        const parsed = JSON.parse(line)
        this.received.push(parsed)
        for (const l of this.listeners) l(parsed)
      } catch { /* 非协议行忽略 */ }
    })
  }

  send(type: string, payload: unknown, kind: 'req' | 'event' = 'req'): string {
    const id = randomUUID()
    this.proc.stdin!.write(JSON.stringify({ v: 1, id, kind, type, payload }) + '\n')
    return id
  }

  /** 等待满足条件的 Envelope（含已收到的） */
  waitFor(pred: (env: any) => boolean, timeoutMs = 10_000): Promise<any> {
    const hit = this.received.find(pred)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waitFor 超时（${timeoutMs}ms）`)), timeoutMs)
      this.listeners.push((env) => {
        if (pred(env)) {
          clearTimeout(timer)
          resolve(env)
        }
      })
    })
  }

  async request(type: string, payload: unknown, timeoutMs = 10_000): Promise<any> {
    const id = this.send(type, payload)
    const res = await this.waitFor((e) => e.kind === 'res' && e.id === id, timeoutMs)
    if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
    return res.payload
  }

  kill(): void {
    this.proc.kill('SIGTERM')
  }

  waitExit(): Promise<void> {
    return new Promise((resolve) => this.proc.once('exit', () => resolve()))
  }
}

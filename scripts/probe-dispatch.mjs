// 真机验收探针：不开壳，直接驱动 harness stdio 走「登录 → @tool dispatch_task →
// fs_write 进 staging → awaiting_approval」全链路，打印全部 Envelope。
// 用途：改完 harness/gateway 后 30 秒内确认审批闭环没断，替代手工点 App。
//
// 前置：pnpm build 且网关已起（pnpm dev:gateway）。
// 用法：node scripts/probe-dispatch.mjs [scope目录]
//   scope目录缺省用系统临时目录下的 petsona-probe-scope（自动创建）。

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 缺省 scope 必须落在 DEFAULT_CONFIG.scopes（~/Downloads、~/Desktop）内，否则任务板白名单会拦
const scopeDir = resolve(process.argv[2] ?? join(homedir(), 'Downloads', 'petsona-probe-scope'))
mkdirSync(scopeDir, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'petsona-probe-data-'))

const h = spawn('node', [join(repoRoot, 'packages/harness/dist/main.js')], {
  env: { ...process.env, PETSONA_KEYCHAIN: 'memory', PETSONA_DATA_DIR: dataDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const send = (o) => h.stdin.write(JSON.stringify(o) + '\n')

let buf = ''
h.stdout.on('data', (d) => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (line.trim()) console.log('<<', line.slice(0, 400))
  }
})

const goal = `@tool fs_write {"path":"${scopeDir}/probe.txt","content":"审批链路探针"}`
const chatText = `@tool dispatch_task {"goal":${JSON.stringify(goal)},"agentType":"worker","scope":{"dirs":[${JSON.stringify(scopeDir)}],"net":false}}`

setTimeout(() => send({ v: 1, id: 'login-1', kind: 'req', type: 'LOGIN_SUBMIT', payload: { email: 'probe@petsona.dev', code: '888888' } }), 800)
setTimeout(() => { console.log('>> CHAT_SEND（期待末尾出现 TASK_EVENT awaiting_approval）'); send({ v: 1, id: 'chat-1', kind: 'req', type: 'CHAT_SEND', payload: { text: chatText } }) }, 2500)
setTimeout(() => { h.kill(); process.exit(0) }, 15_000)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../packages/harness/src/main.js'
import { IPC, type Envelope } from '../../packages/shared/src/index.js'

function req(id: string, type: string, payload: unknown): Envelope {
  return { v: 1, id, kind: 'req', type, payload }
}

function parseRes(line: string): Envelope {
  return JSON.parse(line) as Envelope
}

describe('LLM debug configuration runtime wiring', () => {
  const previous = {
    dataDir: process.env.PETSONA_DATA_DIR,
    keychain: process.env.PETSONA_KEYCHAIN,
    gatewayUrl: process.env.PETSONA_GATEWAY_URL,
  }
  let harness: ReturnType<typeof createHarness>
  let lines: string[]
  let capturedHeaders: Headers
  let originalFetch: typeof fetch

  beforeEach(() => {
    process.env.PETSONA_DATA_DIR = mkdtempSync(join(tmpdir(), 'petsona-llm-debug-'))
    process.env.PETSONA_KEYCHAIN = 'memory'
    process.env.PETSONA_GATEWAY_URL = 'http://127.0.0.1:8787'
    capturedHeaders = new Headers()
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
      capturedHeaders = new Headers(init?.headers)
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { in: 1, out: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    lines = []
    harness = createHarness((line) => lines.push(line))
  })

  afterEach(() => {
    harness.shutdown()
    globalThis.fetch = originalFetch
    if (previous.dataDir === undefined) delete process.env.PETSONA_DATA_DIR
    else process.env.PETSONA_DATA_DIR = previous.dataDir
    if (previous.keychain === undefined) delete process.env.PETSONA_KEYCHAIN
    else process.env.PETSONA_KEYCHAIN = previous.keychain
    if (previous.gatewayUrl === undefined) delete process.env.PETSONA_GATEWAY_URL
    else process.env.PETSONA_GATEWAY_URL = previous.gatewayUrl
  })

  it('保存 llmDebug 配置后，GatewayClient 聊天请求会携带 BYOK baseUrl 和 model 覆盖', async () => {
    await harness.dispatchLine(JSON.stringify(req('set-config', IPC.CONFIG_SET, {
      patch: {
        llmDebug: {
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-v4-flash',
        },
      },
    })))
    await harness.dispatchLine(JSON.stringify(req('set-key', IPC.LLM_KEY_SET, { key: 'sk-test-1234' })))

    const { gateway } = harness._internals
    await gateway.chatOnce({
      tier: 'main',
      system: '',
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
      maxTokens: 8,
      meta: { loop: 'companion' },
    })

    expect(capturedHeaders.get('x-petsona-user-llm-key')).toBe('sk-test-1234')
    expect(capturedHeaders.get('x-petsona-llm-provider')).toBe('deepseek')
    expect(capturedHeaders.get('x-petsona-llm-base-url')).toBe('https://api.deepseek.com/v1')
    expect(capturedHeaders.get('x-petsona-llm-model')).toBe('deepseek-v4-flash')

    const configRes = lines.map(parseRes).find((line) => line.id === 'set-config')
    expect((configRes?.payload as any).config.llmDebug.model).toBe('deepseek-v4-flash')
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const launcher = readFileSync(join(ROOT, '启动Petsona桌面版.command'), 'utf8')

describe('Petsona desktop launcher', () => {
  it('starts and waits for the local gateway before Tauri', () => {
    expect(launcher).toContain('GATEWAY_URL="http://127.0.0.1:8787/healthz"')
    expect(launcher).toContain('corepack pnpm dev:gateway')
    expect(launcher).toContain('curl -fsS "$GATEWAY_URL"')
    expect(launcher).toContain('export PETSONA_GATEWAY_URL="http://127.0.0.1:8787"')
  })

  it('cleans up the gateway process it started when the desktop app exits', () => {
    expect(launcher).toContain('cleanup()')
    expect(launcher).toContain('kill "$GATEWAY_PID"')
    expect(launcher).toContain('trap cleanup EXIT INT TERM')
  })
})

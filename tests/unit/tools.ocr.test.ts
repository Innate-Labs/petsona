// ocr 重工具（SPEC-GAPS H16）：macOS Vision 本地识别，输出 <data> 包裹（§6 注入防护）
// 真跑 xcrun swift（本仓库只针对 macOS，CLT 是 Tauri 构建的既有前置）
import { beforeAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import type { ToolCtx } from '@petsona/shared'
import { ToolRegistry } from '../../packages/harness/src/tools/registry.js'
import { registerHeavyTools } from '../../packages/harness/src/tools/heavy/index.js'
import { resolvePaths } from '../../packages/harness/src/paths.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')

// 用 AppKit 现画一张白底黑字图：不入库二进制 fixture，且字号够大保证 Vision 稳定命中
const GEN_IMG_SWIFT = `
import AppKit
let size = NSSize(width: 480, height: 120)
let img = NSImage(size: size)
img.lockFocus()
NSColor.white.setFill()
NSRect(origin: .zero, size: size).fill()
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 36, weight: .bold), .foregroundColor: NSColor.black]
("PETSONA OCR 2026" as NSString).draw(at: NSPoint(x: 24, y: 40), withAttributes: attrs)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
`

let tmp: string
let fixture: string
let registry: ToolRegistry
let ctx: ToolCtx

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'petsona-ocr-'))
  process.env.PETSONA_DATA_DIR = tmp
  const paths = resolvePaths('anon-ocrtest')
  mkdirSync(join(paths.root, 'bin'), { recursive: true })
  copyFileSync(join(REPO, 'packages/assets/bin/ocr.swift'), join(paths.root, 'bin/ocr.swift'))

  const genScript = join(tmp, 'gen.swift')
  writeFileSync(genScript, GEN_IMG_SWIFT)
  fixture = join(tmp, 'fixture.png')
  execFileSync('/usr/bin/xcrun', ['swift', genScript, fixture], { timeout: 60_000 })

  registry = new ToolRegistry('subagent')
  registerHeavyTools(registry, { paths })
  ctx = {
    taskId: 'ocr-test',
    scope: { dirs: [tmp], net: false },
    dataDir: paths.root,
    emit: () => {},
    gateway: null,
  }
}, 90_000)

describe('ocr 工具', () => {
  it('识别图片文字并 <data> 包裹返回', async () => {
    const out = (await registry.get('ocr')!.handler({ path: fixture }, ctx)) as { ok: boolean; text: string }
    expect(out.ok).toBe(true)
    expect(out.text).toContain('<data>')
    expect(out.text).toContain('PETSONA')
    expect(out.text).toContain('2026')
  }, 90_000)
  it('图片不存在 → 明确报错（skill 走退化路径）', async () => {
    await expect(registry.get('ocr')!.handler({ path: join(tmp, 'nope.png') }, ctx)).rejects.toThrow('图片不存在')
  })
})

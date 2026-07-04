// 首装拷贝：packages/assets → $DATA（skills/、personas/、fallback/，§2.2）
// 已存在的用户文件不覆盖（用户可改技能/人格，更新只补新增）

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DataPaths } from './paths.js'

export function bootstrapAssets(paths: DataPaths): void {
  const assetsRoot = resolveAssetsDir()
  if (!assetsRoot) {
    console.error('[bootstrap] 未找到 assets 目录，跳过资产拷贝')
    return
  }
  copyMissing(join(assetsRoot, 'skills'), paths.skills)
  copyMissing(join(assetsRoot, 'personas'), paths.personas)
  copyMissing(join(assetsRoot, 'fallback'), join(paths.root, 'fallback'))
  copyMissing(join(assetsRoot, 'bin'), join(paths.root, 'bin'))   // ocr.swift 等本地工具脚本
}

function resolveAssetsDir(): string | null {
  if (process.env.PETSONA_ASSETS_DIR && existsSync(process.env.PETSONA_ASSETS_DIR)) {
    return process.env.PETSONA_ASSETS_DIR
  }
  // dev：从 dist/bootstrap.js 向上找 packages/assets；打包后由壳注入 PETSONA_ASSETS_DIR（SPEC-GAP）
  const here = dirname(fileURLToPath(import.meta.url))
  for (const rel of ['../../assets', '../../../assets']) {
    const p = join(here, rel)
    if (existsSync(join(p, 'fallback'))) return p
  }
  return null
}

function copyMissing(srcDir: string, dstDir: string): void {
  if (!existsSync(srcDir)) return
  mkdirSync(dstDir, { recursive: true })
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const dst = join(dstDir, entry.name)
    if (existsSync(dst)) continue
    cpSync(join(srcDir, entry.name), dst, { recursive: true })
  }
}

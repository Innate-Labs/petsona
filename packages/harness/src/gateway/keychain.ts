// macOS Keychain 存取（service=dev.petsona.app）——JWT 禁止落磁盘明文（§2.1）
// 经 /usr/bin/security CLI 而非原生模块：零编译依赖，且属本地系统调用非网络请求（缝①不受影响）

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SERVICE = 'dev.petsona.app'
const SECURITY = '/usr/bin/security'

// 测试环境（PETSONA_KEYCHAIN=memory）用内存实现，避免 CI 弹 Keychain 授权
const memoryStore = new Map<string, string>()

function useMemory(): boolean {
  return process.env.PETSONA_KEYCHAIN === 'memory'
}

export async function keychainSet(account: string, secret: string): Promise<void> {
  if (useMemory()) { memoryStore.set(account, secret); return }
  // -U：存在则更新
  await execFileAsync(SECURITY, ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', secret])
}

export async function keychainGet(account: string): Promise<string | null> {
  if (useMemory()) return memoryStore.get(account) ?? null
  try {
    const { stdout } = await execFileAsync(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', account, '-w'])
    return stdout.replace(/\n$/, '')
  } catch {
    return null   // 未找到或用户拒绝授权 → 调用方走重新登录流程（§7 Keychain 拒绝兜底）
  }
}

export async function keychainDelete(account: string): Promise<void> {
  if (useMemory()) { memoryStore.delete(account); return }
  try {
    await execFileAsync(SECURITY, ['delete-generic-password', '-s', SERVICE, '-a', account])
  } catch {
    // 不存在视为已删除
  }
}

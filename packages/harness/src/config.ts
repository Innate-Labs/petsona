// Config / Persona 读写（$DATA/config.json、persona.json）

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Config } from '@petsona/shared'
import { DEFAULT_CONFIG } from '@petsona/shared'
import type { DataPaths } from './paths.js'

export class ConfigStore {
  private config: Config

  constructor(private paths: DataPaths) {
    this.config = this.loadConfig()
  }

  private loadConfig(): Config {
    if (existsSync(this.paths.config)) {
      try {
        return mergeConfig(JSON.parse(readFileSync(this.paths.config, 'utf8')))
      } catch { /* 损坏回默认 */ }
    }
    const cfg = { ...DEFAULT_CONFIG, gatewayUrl: process.env.PETSONA_GATEWAY_URL || DEFAULT_CONFIG.gatewayUrl }
    writeFileSync(this.paths.config, JSON.stringify(cfg, null, 2))
    return cfg
  }

  get(): Config { return this.config }

  patch(partial: Partial<Config>): Config {
    this.config = mergeConfig(partial, this.config)
    writeFileSync(this.paths.config, JSON.stringify(this.config, null, 2))
    return this.config
  }

  getPersona(): object {
    if (existsSync(this.paths.persona)) {
      try { return JSON.parse(readFileSync(this.paths.persona, 'utf8')) } catch { /* 回默认 */ }
    }
    return { persona_id: 'default' }   // 继承 v2.1 §2.3 字段 + persona_id；M1 占位
  }

  setPersona(p: object): object {
    writeFileSync(this.paths.persona, JSON.stringify(p, null, 2))
    return p
  }
}

function mergeConfig(partial: unknown, base: Config = DEFAULT_CONFIG): Config {
  const patch = (typeof partial === 'object' && partial !== null ? partial : {}) as Partial<Config>
  return {
    ...base,
    ...patch,
    pet: { ...base.pet, ...(patch.pet ?? {}) },
    llmDebug: { ...base.llmDebug, ...(patch.llmDebug ?? {}) },
    reminders: {
      ...base.reminders,
      ...(patch.reminders ?? {}),
      pomodoro: { ...base.reminders.pomodoro, ...(patch.reminders?.pomodoro ?? {}) },
    },
    proactive: { ...base.proactive, ...(patch.proactive ?? {}) },
    taskBudget: { ...base.taskBudget, ...(patch.taskBudget ?? {}) },
    scopes: patch.scopes ?? base.scopes,
  }
}

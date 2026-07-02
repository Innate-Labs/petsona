// 云网关入口（v3.0 §2.2 apps/gateway；Fastify + TS + ESM）
// buildServer 与 listen 分离：测试用 fastify inject，不占端口。

import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { pathToFileURL } from 'node:url'
import { env } from './env.js'
import { errBody } from './lib/http.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerLlmRoutes } from './routes/llm.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerTrackRoutes } from './routes/track.js'

// 版本比较：只比 major.minor.patch 数字段（SPEC-GAP: 规格未定预发布号规则，忽略 -beta 等后缀）
function versionLower(a: string, b: string): boolean {
  const pa = a.split('-')[0]!.split('.').map(Number)
  const pb = b.split('-')[0]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (Number.isNaN(x)) return false   // 非法版本头不当作旧版本拦截，交给业务层
    if (x !== y) return x < y
  }
  return false
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.isProd() })

  await app.register(cors, { origin: env.corsOrigin() })

  // 强制升级门（v3.0 §2.4 DESKTOP_MIN_VERSION）：客户端带 x-petsona-version，低于阈值回 426。
  // 为什么不拦「没带头」的请求：curl/健康检查/老测试脚本不带版本头，只对声明了版本的客户端把关。
  app.addHook('onRequest', async (req, reply) => {
    const ver = req.headers['x-petsona-version']
    if (typeof ver === 'string' && ver && versionLower(ver, env.desktopMinVersion())) {
      // SPEC-GAP: v2.1 错误码枚举无升级专用码，用 UPGRADE_REQUIRED（HTTP 426 语义一致）
      return reply.code(426).send(
        errBody('UPGRADE_REQUIRED', `客户端版本过旧（${ver} < ${env.desktopMinVersion()}），请升级桌面版`),
      )
    }
  })

  // 健康检查（SPEC-GAP: 规格未列，运维必备，不带业务语义）
  app.get('/healthz', async () => ({ ok: true, uptimeSec: Math.floor(process.uptime()) }))

  registerAuthRoutes(app)
  registerLlmRoutes(app)
  registerMemoryRoutes(app)
  registerTrackRoutes(app)

  return app
}

// 直接运行（node dist/server.js / tsx src/server.ts）才 listen；被测试 import 时不启动
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const app = await buildServer()
  try {
    await app.listen({ port: env.port(), host: '0.0.0.0' })
    console.log(`[gateway] listening on :${env.port()}（CORS_ORIGIN=${env.corsOrigin()}，LLM_PROVIDER=${process.env.LLM_PROVIDER ?? 'mock'}）`)
  } catch (e) {
    console.error('[gateway] 启动失败', e)
    process.exit(1)
  }
}

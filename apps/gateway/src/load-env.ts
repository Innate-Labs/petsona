// 为什么单独文件而非塞进 server.ts：这一行必须在任何 import { env } from './env.js' 之前
// 执行，独立模块 + import 顺序在最顶端最直白，且被 test / dist 复用时也不会跑漏。
// Node 22.6+ 自带 process.loadEnvFile()，缺省读 cwd 下 .env，缺失/语法错静默降级——
// 生产用真实环境变量覆盖，dev 才有 .env，二者路径统一。
try {
  process.loadEnvFile()
} catch {
  // .env 不存在或不可读：走进程环境变量，不打印以免真机日志噪声
}

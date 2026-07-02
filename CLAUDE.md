# CLAUDE.md — 宠格 Petsona 桌面版

macOS 桌宠 Agent（Tauri 壳 + Node Harness + 云网关）。运行/测试/接 LLM 见 [README.md](README.md)。

## 规格与文档指针

| 文档 | 用途 |
|---|---|
| `../宠格Petsona-桌面版开发规格说明书-v3.0.md` | **唯一真源**（接口契约/数据模型/里程碑） |
| `../宠格Petsona-桌面版Harness架构设计-v0.1.md` | 架构疑义查这里（设计取舍、s01–s20/p01–p04 机制） |
| `../宠格Petsona-开发规格说明书.md`（v2.1） | 标「继承 v2.1」的条款按原文执行 |
| `../宠格_Petsona_提示词体系_V0.1.md` | 13 个 prompt 定义 |
| [SPEC-GAPS.md](SPEC-GAPS.md) | 规格空白的默认决策（30+ 条，回填规格前必读） |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 当前交接状态、真机 smoke check、M2 开工入口 |
| `../learn-claude-code-main/` | 机制编号出处（Python 教学参考，**不复用代码**） |

## 硬边界（违反即架构污染；tests/unit/structural.test.ts 机器强制）

- **缝①**：harness 内网络请求只许出现在 `packages/harness/src/gateway/client.ts`（fetch/axios 静态扫描）。
- **缝②**：面向用户的文本必经 persona 出口（`persona/wrap.ts`）或兜底文案池，不得散落硬编码。
- **缝③**：业务代码只依赖 `MemoryStore` 接口，不直连 SQLite/文件。
- **缝④**：本地数据一律 `$DATA/<userId>/` 命名空间。
- companion 循环**禁止**注册重工具（registry 注册期抛错，名单在 shared/tool.ts）。
- builtin L3 权限规则**不可**被 user 规则降级（`permission/rules.ts` 合并期抛错）。
- token 只进 macOS Keychain（`security` CLI，service=`dev.petsona.app`），**禁落磁盘**。
- **禁任何 `rm`/直删**：$DATA 内清理走移动或 `.trash/`；对用户文件只有 `fs_trash`（进废纸篓，M2）。
- vendor LLM SDK import 只许 `apps/gateway/src/providers/`（当前实现是 fetch 直连，零 SDK）。
- 协议类型唯一真源 `packages/shared`，壳/harness/网关只 import **不复制**。
- 埋点/兜底/权限是横切逻辑，走 hooks 管线（`hooks/pipeline.ts` 注册），**禁止**在技能或业务内重复实现。

## 开发标准

- Conventional Commits；单文件 ≤300 行；中文注释写「为什么」。
- 契约变更：先改 `packages/shared` + 规格文档，再改实现。
- 规格没写的：按行业默认实现 + `// SPEC-GAP: xxx` 内联标注 + 同步进 SPEC-GAPS.md。

## 命令速查

```bash
pnpm install && pnpm build       # shared → harness → gateway
pnpm test                        # 全量 12 文件 72 用例（结构约束/契约/Gate ①②③⑤）
pnpm dev:gateway                 # 网关 :8787，缺省 Mock LLM
cd apps/shell && pnpm tauri:dev  # 桌面 App（需 source ~/.cargo/env）
pnpm --filter @petsona/shell dev # 只调 UI：浏览器 :5173，内置 mock 总线
```

测试环境变量：`PETSONA_KEYCHAIN=memory`（免弹钥匙串）、`PETSONA_DATA_DIR=<tmp>`（隔离数据）、`PETSONA_GATEWAY_URL`。
harness 其他 env：`PETSONA_HARNESS_CMD`（壳 spawn sidecar 的覆盖命令）、`PETSONA_ASSETS_DIR`、`PETSONA_LOG_LEVEL=debug`（res 附 hookTrace）。
网关 LLM env 见 README「接入真实 LLM」。

## 里程碑状态（写代码前必知）

M1「会陪」已交付；**M2 未开工**——`dispatch_task` 是占位（返回「M2 才会干活喵」），重工具/子 Agent/staging/审批撤销/4 技能都不存在；调度器与心跳只有类型与目录（M3）；`dream()` 空实现（M3）。M1 手动验收和 M2 开工入口见 docs/HANDOFF.md。

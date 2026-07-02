# SPEC-GAP 汇总（M1 · 2026-07-02）

> 规格没写、按行业默认实现并标 `// SPEC-GAP` 的全部条目（v3.0 附录 A.3 要求交付时汇总 review 回填规格）。
> 逐条给出：位置 → 缺口 → 本次采用的默认 → 回填建议。**已按模块分组，标 ⭐ 的建议优先拍板。**

## packages/shared（契约层）

| # | 位置 | 缺口 | 采用默认 | 回填建议 |
|---|---|---|---|---|
| S1 | ipc.ts | 规格未指定运行时校验库 | 手写轻量 isEnvelope（零依赖） | 规格明确是否引入 zod/ajv |
| S2 | tool.ts / llm.ts | §2.2 shared 文件清单未列这两个文件，但 ToolDef/网关协议属共享契约 | 归入 shared 新文件 | 规格 §2.2 文件清单补这两项 |
| S3 | telemetry.ts | 批量上报阈值/间隔未定 | 20 条或 30s 先到先发，失败回缓冲上限 200 | 规格 §9 补数值 |
| S4 | config.ts | 默认网关地址、番茄钟默认值未给 | dev `http://127.0.0.1:8787`；番茄钟 25/5 | 规格 §2.3 Config 补默认值表 |

## packages/harness

| # | 位置 | 缺口 | 采用默认 | 回填建议 |
|---|---|---|---|---|
| H1 | paths.ts | deviceId 生成/存放未定义 | `$ROOT/device.json` 存 8 位 uuid | 规格 §2.3 补 deviceId 条目 |
| H2 | bootstrap.ts | 打包态 assets 定位未定义 | dev 相对路径回溯；打包后壳注入 `PETSONA_ASSETS_DIR` | 规格 §2.2 补打包资产布局 |
| H3 ⭐ | memory/sqlite.ts、coldfs.ts | 话题匹配算法未细化 | hot/warm 用 topics JSON 包含匹配；cold 用 topic 前缀+相等 | 规格 §3.9 定匹配语义（影响 callback 命中率） |
| H4 | memory/store.ts | remember 工具无 topic 参数 | 按 type 归桶（preference→pref） | §3.6 remember input 增加可选 topic |
| H5 | hooks/pre/local_rate.ts | 本地频控阈值未给 | 20 次/分钟 | 规格 §3.7 补阈值 |
| H6 ⭐ | loop/companion.ts | 陪伴循环单轮工具循环上限未定 | 6 轮防失控 | 规格 §3.3/§5 定上限与超限话术 |
| H7 | hooks/pre/injection_guard.ts、persona/enforce.ts | M1 允许 stub（v3.0 A.3） | 基础标记剥离已生效 | M2 交付完整策略（已在计划内，非缺口） |
| H8 | tools/light read_context | M1 无窗口标题/选中文字（需 AX API） | 前台 App 名 + 剪贴板（<data> 包裹） | M2 屏幕问答一并交付（已在计划内） |
| H9 | tools/light schedule_reminder | 各 kind 默认 cron 未给 | water 每小时、stand 45min、pomodoro 25min | 规格 §3.8 补默认 cron 表 |
| H10 | main.ts 匿名→登录迁移 | M1 登录仅切换鉴权态，未做 anon 目录迁移 | 数据仍在 anon-<deviceId> 目录 | §2.3 迁移流程 M2 落地时对齐 §3.6 云同步 |

## apps/gateway

| # | 位置 | 缺口 | 采用默认 | 回填建议 |
|---|---|---|---|---|
| G1 ⭐ | governance.ts | v2.1 指定 Redis 承载限流/用量 | 单实例内存实现，键名语义保留（重启清零） | 多实例部署前必须接 Redis；规格标注单机例外 |
| G2 | routes/llm.ts | 预算熔断错误码未定 | 归类 RATE_LIMIT/429；任务预算超限 402 TASK_BUDGET_EXCEEDED | 规格 §3.2 补预算错误码 |
| G3 | env.ts | BUDGET_DAILY_USD 本次任务定 5（v2.1 原文 50）；token 单价未给 | 单价 env LLM_PRICE_IN/OUT_USD_PER_MTOK 默认 2/8 | 规格统一预算与计价参数 |
| G4 | server.ts | 版本门错误码 v2.1 枚举无对应 | HTTP 426 + UPGRADE_REQUIRED；未带版本头不拦截 | 规格 §2.4 DESKTOP_MIN_VERSION 语义补齐 |
| G5 ⭐ | routes/auth.ts、auth/store.ts | 生产邮件服务未接；用户存储用内存 Map+JSON 文件（v2.1 为 Postgres+Redis） | dev 打印验证码 + 固定码 888888；AUTH_STORE_FILE 可选持久化 | 上线前接 EMAIL_PROVIDER 与真实存储 |
| G6 | auth/store.ts | 验证码错误尝试上限未给 | 5 次锁码 | 规格 §3.3 补 |
| G7 | env.ts / factory.ts | LLM_PROVIDER 单开关命名系本次约定（v2.1 分档命名） | LLM_PROVIDER=mock\|openai\|anthropic + 分档 env | 规格定版 env 命名 |
| G8 | providers/* | Anthropic 分档模型 env 名、max_tokens 缺省、上游超时、流式 usage 估算口径均未给 | ANTHROPIC_MAIN/CHEAP_MODEL、4096、60s、1 token≈2 字符 | 规格 §2.1.1 补 provider 参数表 |
| G9 | routes/memory.ts | push/pull 区分方式未定 | body.mode 显式字段 | 规格 §3.2 定版（或拆两个端点） |
| G10 | routes/track.ts | 埋点端点鉴权未定 | 不强制 Bearer（匿名设备起步） | 规格 §9 明确 |
| G11 | 合规测试 | v2.1 原文 MUST 仅 7 条 | 第 8 条按「错误四码可区分」能力契约补齐 | 规格勘误 MUST 计数 |

## apps/shell

| # | 位置 | 缺口 | 采用默认 | 回填建议 |
|---|---|---|---|---|
| P1 ⭐ | bridge.rs | sidecar 二进制打包流程未做 | dev 用 `node packages/harness/dist/main.js`（PETSONA_HARNESS_CMD 可覆盖） | 发布流程补 Node SEA/pkg 打包与签名 |
| P2 | macos/idle.rs | 全屏检测需 CGWindowList 遍历 | M1 恒 false | M3 fullscreenMute 落地时实现 |
| P3 | pet_window.rs | PET_MOVED 位置持久化恢复未做 | 每次启动右下角 | M1 后补（壳本地存储） |
| P4 | pet_window.rs | NSPanel 桥失败降级为普通置顶窗口 | 已编译通过，降级仅为兜底 | 无需回填，保留兜底 |
| P5 | icons/ | 正式图标未交付（美术任务，本轮排除） | 生成的占位 PNG | 美术 A 按 v3.0 A.4 交付 |

## 测试口径说明

- Gate ③「cold 记忆存活并 callback」在单元层覆盖三层（tests/e2e/gate3.memory.test.ts），进程层覆盖 hot 历史回读；cold 的**对话内** callback 需真实 LLM 表现，属 M3 评测集范围。
- LLMProvider 合规测试对 MockProvider 跑通；openai_compat/anthropic 真 key 场景需配 `LLM_UNDER_TEST_PROVIDER` 后跑同一套（v2.1 上生产前置条件）。
- memory/sync 未做 deviceId↔userId 匿名迁移合并，M2 接 harness 同步时补。

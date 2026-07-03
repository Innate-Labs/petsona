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
| H11 ⭐ | tools/heavy shell | 任意 shell 命令如何进入 staging 未定义 | `shell` 即时执行，只走 scope/permission/audit 与 builtin L3；文件类重工具单独 staging | 规格 §3.5/§3.6 补命令级审批或限定 shell 用途 |
| H12 | tools/heavy web_fetch | harness 不能直接出网，gateway 代理协议规格未定义 | 已实现 `POST /v1/proxy/fetch`（鉴权+SSRF 拦内网+10s 超时+字节上限），返回文本经 `<data>` 包裹入上下文 | 规格 §3.6 收录该协议定义 |
| H13 | staging/store.ts | undo journal 保留/归档后台未定义 | 按 `UNDO_RETENTION_DAYS=7` 类型常量写 journal，不做自动清理 | 规格 §3.4 补归档触发与失败处理 |
| H14 | shared/ipc.ts AUTH_STATE_GET | §3 消息表无登录态拉取 req；仅广播在真机有「广播早于面板订阅」竞态 | 新增 `AUTH_STATE_GET` req 返回当前 authState，面板挂载时拉取兜底 | 规格 §3.1 消息表收录 |
| H15 | routes/proxy.ts | 单测需在环回地址自起 http 服务验证真实抓取，与 SSRF 拦截冲突 | 环境变量 `PETSONA_PROXY_ALLOW_LOOPBACK=1` 测试专用逃生口 | 规格 §8 测试口径收录或改用可配置 allowlist |
| H16 | skills/screen_qa | 本地 OCR 命令行封装未定义（macOS Vision 无官方 CLI） | SKILL.md 允许退化：截图落任务目录+findings 说明无法 OCR | M3 前交付 OCR 封装（Vision framework 或 shortcuts） |
| H17 | lib.rs open_panel | 面板深链 hash 规则规格未写 | 统一 `#/panel[/<page>]`，open_panel 负责补前缀；首建窗口 URL 也带子页 | 规格 §4 面板路由表收录 |
| H18 | scheduler/cron.ts | 5 段 cron 表达不了任意分钟间隔（喝水 60/站立 45） | water/stand/pomodoro 走 lastFiredAt+间隔判定；water/stand 间隔实时读 config，pomodoro 会话内取 payload | 规格 §3.8 补 CronJob 间隔类任务口径 |
| H19 | scheduler/cron.ts | 番茄钟重启恢复未定义 | durable=false：重启丢会话（中断的专注段无意义），water/stand/dream durable | 规格 §3.8 收录 |
| H20 | shared/schedule.ts REMINDER_EXPIRES_MS | 提醒被勿扰/全屏压住后的滞留上限未定义 | 10 分钟过期丢弃（常量 dedupeKey 保证压住期间不堆积） | 规格 §3.8 补消费口径 |
| H21 | scheduler/heartbeat.ts | p01 空闲阈值与模型 skip 后的再询问间隔未定义 | 阈值=频次档最小间隔（PROACTIVE_MIN_GAP）；skip 后 5min 内不再询问 | 规格 §3.8 补 p01 参数表 |
| H22 | main.ts emitProactive | 主动气泡是否落对话历史未定义 | 落 hot 轮次（pet role）：下一轮模型知道自己说过什么，语义去重也有据可查 | 规格 §3.8 收录 |
| H23 | memory/dream.ts mergeDupes | Dream「合并重复」的相似口径未定义 | 精确判重（type+topic+body 全等，留 lastT 最新）；语义级逐对调 cheap 档夜跑 200 条代价过高，extract 入库时已有语义去重挡第一道 | 规格 §3.8 定判重口径 |
| H24 | memory/dream.ts evictOverflow | 「lastT 老且低频」的“低频”无访问计数字段 | 按 lastT 单维从老到新淘汰，source=settings 永不淘汰 | 规格 §2.3 补访问频次字段或改口径 |
| H25 | shared/ipc.ts MEMORY_GET | §3.1 消息表无单条记忆拉取；LIST 只回 40 字 gist，管理页编辑需要完整 body | 新增 `MEMORY_GET {name}` req 返回完整 ColdItem（同 H14 增补先例） | 规格 §3.1 消息表收录 |

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
| P3 | pet_window.rs | 规格未定义 PET_MOVED 后的壳层位置存储位置 | Tauri app data 写 `pet-window.json`，启动优先恢复；坐标越界则回右下角 | §4 补充宠物窗位置恢复策略与存储位置 |
| P4 | pet_window.rs | NSPanel 桥失败降级为普通置顶窗口 | 已编译通过，降级仅为兜底 | 无需回填，保留兜底 |
| P5 | icons/ | 正式图标未交付（美术任务，本轮排除） | 生成的占位 PNG | 美术 A 按 v3.0 A.4 交付 |

## 测试口径说明

- Gate ③「cold 记忆存活并 callback」在单元层覆盖三层（tests/e2e/gate3.memory.test.ts），进程层覆盖 hot 历史回读；cold 的**对话内** callback 需真实 LLM 表现，属 M3 评测集范围。
- LLMProvider 合规测试对 MockProvider 跑通；openai_compat/anthropic 真 key 场景需配 `LLM_UNDER_TEST_PROVIDER` 后跑同一套（v2.1 上生产前置条件）。
- memory/sync 未做 deviceId↔userId 匿名迁移合并，M2 接 harness 同步时补。

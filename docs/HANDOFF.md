# 宠格 Petsona 桌面版交接

本仓库当前交付 M1「会陪」+ M2「会干」核心：macOS 桌宠壳、本地 harness、可 mock 的云网关、任务板/子 Agent/staging 审批撤销闭环。M1 与 M2 主链路已于 2026-07-02 在真机完成人工+自动混合验收。

## 当前状态

- `pnpm build`、`pnpm --filter @petsona/shell build`、`pnpm test`（84 用例）全部通过。
- 真机验收（2026-07-02，Node 22 机器）已确认：
  - 登录（固定码 888888）→ 主面板；重启后登录态经 Keychain + `AUTH_STATE_GET` 自动恢复。
  - 聊天流式回复（面板对话记录页与快捷浮窗）；聊天历史跨重启存活。
  - 桌宠拖动、位置落盘（`pet-window.json`）、重启恢复；快捷浮窗头部可拖动。
  - worker 审批闭环：`dispatch_task` → `awaiting_approval` → 面板批准 → 文件才落盘 → 撤销恢复原内容。
- `web_fetch` 已接 gateway `/v1/proxy/fetch` 代理（SSRF 防护 + 大小/超时上限），harness 网络出口仍唯一（缝①）。
- `packages/assets/skills/` 四个 M2 技能（organize_files/clean_trash/find_stuff/screen_qa）已交付 ready 正文。
- 真机验收共修复 8 个此前未暴露的问题，见下节。

## 真机验收修复清单（2026-07-02）

1. `src-tauri/capabilities/` 缺失 → Tauri v2 ACL 静默拒绝 `event:listen`，harness→UI 响应全部超时（登录必挂）。
2. harness 登录调 `/v1/auth/verify-code`，网关路由是 `/v1/auth/login`（e2e mock 网关同步对齐）。
3. 登录态恢复广播早于面板订阅（竞态）→ 新增 `AUTH_STATE_GET` req，面板挂载时拉取兜底。
4. `config.scopes` 的 `~` 不展开 → 默认配置下 `dispatch_task` 必然 SCOPE_VIOLATION。
5. access token 15 分钟过期且无人调用 `refresh()` → 登录一刻钟后全功能永久 401；现 401 自动刷新重试一次。
6. 子 Agent 最终摘要非 JSON 时异常绕过 staging 检查 → 已 staged 计划被丢弃；现解析失败但有待审批改动时照常进入审批。
7. `core:default` 不含 `allow-start-dragging` → 桌宠/浮窗任何人都拖不动；已显式加权限，浮窗头部补 `data-tauri-drag-region`。
8. `open_panel` 深链少 `#/panel/` 前缀 → 浮窗「历史」与桌宠菜单子页全部落回首页；现统一补前缀，窗口首建也带子页。

## 真机 Smoke Check

1. `pnpm dev:gateway`
2. `pnpm --filter @petsona/shell tauri:dev`（或打 debug bundle：`cd apps/shell && pnpm tauri build --debug --bundles app`，MCP/自动化验收需要 bundle 注册 LaunchServices）
3. 任意邮箱登录，开发验证码 `888888`。
4. 聊天、拖动桌宠重启验位置、桌宠菜单「聊天」开浮窗。
5. worker 审批闭环（mock LLM 用 `@tool` 钩子触发）：聊天发送
   `@tool dispatch_task {"goal":"@tool fs_write {\"path\":\"<scope内路径>\",\"content\":\"x\"}","agentType":"worker","scope":{"dirs":["<scope目录>"],"net":false}}`
   → 设置中心 → 审批与撤销 → 批准 → 验证文件 → 撤销 → 验证恢复。

## 已知边界

- `shell` 仍是即时执行工具（scope/permission/audit + builtin L3），命令级 staging 未设计。
- 审批页入口在 设置中心 → 审批与撤销（首页四卡不含审批，Figma IA 如此）。
- 调度 tick、主动心跳、全屏静默、记忆 Dream、记忆管理 UI 属于 M3；AudioProvider 属于 M4。
- 生产邮件服务、Redis/Postgres 网关存储、sidecar 打包签名、正式美术资产未完成。
- 全屏检测恒返回 `false`（`apps/shell/src-tauri/src/macos/idle.rs`）。
- screen_qa 的本地 OCR 命令行封装未落地，技能内允许退化路径（见 SKILL.md 与 SPEC-GAPS）。

## 关键文件

- `README.md` / `CLAUDE.md` / `SPEC-GAPS.md` — 快速开始 / Agent 规则 / 规格空白决策。
- `docs/M2_TASK_BOARD.md` — M2 任务板、子 Agent、staging、审批、undo 机制与验收说明。
- `apps/shell/src-tauri/capabilities/default.json` — Tauri v2 ACL（event/listen + start-dragging）。
- `apps/shell/src-tauri/src/lib.rs` — 面板深链、浮窗、装配。
- `packages/harness/src/main.ts` — IPC 路由、任务板、审批/撤销装配。
- `packages/harness/src/gateway/client.ts` — 唯一网络出口：auth/chat/proxyFetch/401 自动刷新。
- `apps/gateway/src/routes/proxy.ts` — web_fetch 代理端点（SSRF 防护）。
- `packages/assets/skills/` — 4 个 ready 技能 + INDEX。

## 建议下一步

1. M3 开工：调度 tick、主动心跳（p01/p02）、全屏静默、记忆 Dream、记忆管理页。
2. screen_qa 的本地 OCR 命令行封装（macOS Vision）。
3. 把真机验收步骤沉淀为可重复脚本（scripts/probe-dispatch 已有雏形，在会话 scratchpad，可迁入 repo）。

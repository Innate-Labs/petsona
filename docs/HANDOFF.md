# 宠格 Petsona 桌面版交接

本仓库当前交付 M1「会陪」+ M2「会干」+ M3「会提醒 + 会梦」核心，已于 2026-07-02 完成 M1/M2 真机验收、2026-07-03 完成 M3 真机验收。剩余里程碑：M4 AudioProvider、生产邮件/存储、sidecar 打包签名、正式美术资产。

## 当前状态

- `pnpm build`、`pnpm --filter @petsona/shell build`、`pnpm test`（164 用例）全部通过。
- 真机验收（2026-07-02 首轮 M1/M2、2026-07-03 M3 + UI 二轮 + 三轮，Node 22 机器）已确认：
  - **登录/聊天/桌宠**：固定码 888888 登录 → 主面板；重启后经 Keychain + `AUTH_STATE_GET` 恢复；流式回复、历史跨重启；桌宠位置落盘（`pet-window.json`）与恢复；快捷浮窗头部可拖动。
  - **审批闭环**：`dispatch_task` → `awaiting_approval` → 面板批准 → 文件才落盘 → 撤销恢复原内容。
  - **M3 调度器**：30s tick、pomodoro/water/stand 三条提醒线 REMINDER_SET/STOP 落盘 `scheduled.json`、REMINDER_FIRED 消费器直出气泡文案池（缝②）、勿扰/全屏押回、心跳 p01/p02。
  - **M3 记忆**：Dream 夜跑 hot→warm→cold 三连压缩 + consolidate + 索引重建；记忆管理页分类视图/编辑/删除/清空（新增 `MEMORY_GET` 协议 H25）。
  - **M3 全屏静默**：`macos/idle.rs` CGWindowList 真实现（原 M1 恒 false 兜底废弃）。
  - **M3 screen_qa**：`ocr` 重工具（`$DATA/bin/ocr.swift` macOS Vision zh/en）落地，SKILL.md 退化路径仍保留兜底。
  - **M3 目录迁移**：匿名→登录本地目录经 `pending-migration.json` 下次启动落地（原地 rename + `.trash/` 归档旧数据，禁 rm）。
  - **UI 三轮验收修复（2026-07-03）**：见下节。
- `web_fetch` 已接 gateway `/v1/proxy/fetch` 代理（SSRF 防护 + 大小/超时上限），harness 网络出口仍唯一（缝①）。
- `packages/assets/skills/` 四个 M2 技能（organize_files/clean_trash/find_stuff/screen_qa）已交付 ready 正文；宠物美术接入五姿势 HEVC-alpha .mov 动作视频（`character.ts` 头部含 ffmpeg 转码配方）。

## 首轮真机验收修复（2026-07-02，M1/M2）

1. `src-tauri/capabilities/` 缺失 → Tauri v2 ACL 静默拒绝 `event:listen`，harness→UI 响应全部超时（登录必挂）。
2. harness 登录调 `/v1/auth/verify-code`，网关路由是 `/v1/auth/login`（e2e mock 网关同步对齐）。
3. 登录态恢复广播早于面板订阅（竞态）→ 新增 `AUTH_STATE_GET` req，面板挂载时拉取兜底。
4. `config.scopes` 的 `~` 不展开 → 默认配置下 `dispatch_task` 必然 SCOPE_VIOLATION。
5. access token 15 分钟过期且无人调用 `refresh()` → 登录一刻钟后全功能永久 401；现 401 自动刷新重试一次。
6. 子 Agent 最终摘要非 JSON 时异常绕过 staging 检查 → 已 staged 计划被丢弃；现解析失败但有待审批改动时照常进入审批。
7. `core:default` 不含 `allow-start-dragging` → 桌宠/浮窗任何人都拖不动；已显式加权限，浮窗头部补 `data-tauri-drag-region`。
8. `open_panel` 深链少 `#/panel/` 前缀 → 浮窗「历史」与桌宠菜单子页全部落回首页；现统一补前缀，窗口首建也带子页。

## 三轮真机验收修复（2026-07-03，UI 与 M3）

首先是「宠物透明底」问题——原始 VP9-alpha webm 在 WKWebView 必黑底，改用 ffmpeg 转 HEVC-alpha .mov 接入五姿势（sit/wave/yawn/stretch/cheer），Sprite onError 自动降级图集兜底。随后 UI 侧一次性解决 5 个问题：

1. **面板窗 `window.prompt/confirm/alert` 失灵**（免打扰、Todo 新增、记忆编辑/删除/清空、宠物改名、字段编辑、形象上传提示全部点了没反应）—— Tauri（macOS WKWebView）默认不实现这三个 API。`ui/panel/kit.tsx` 新增 `<ModalHost>` + `useDialog()` 三方法（prompt/confirm/alert，语义贴齐浏览器：ESC + 遮罩点击取消、Enter 提交、autoFocus）。Panel.tsx 三分支统一挂载。**硬约束**：面板窗任何按钮的交互都必须走 `useDialog()`，不得再直接调 window.\*。
2. **桌宠单击弹菜单去掉**：原「点击 → 四选项菜单」会让宠物 flex 上移只剩下半身，且菜单本身不方便。改为「单击 → 播放 wave 动作视频 3.5s → 回落 sit；双击 → 直接打开主面板」。`PetWindow.tsx` 用 `setTimeout(DOUBLE_CLICK_MS=260)` 让单双击互斥、`WAVE_MS=3500` 控制回落。
3. **拖拽桌宠触发 wave**：`onMouseMove` 里位移 >4px 判定拖拽的同时调 `triggerWave()`。
4. **主面板贴内容**：`panel.css` 的 `.panel-shell` 撤 max-width 撑满窗口（`@media(min-width:600px)` 仅浏览器原型走手机比例居中），`src-tauri/src/lib.rs` 面板窗从 920×640 缩到 440×560，宽度贴内容、高度装下 hero+2×2 卡+新增输入框+页头页脚。
5. **主页快捷输入框**：`Home.tsx` 底部加 `.home-quick`，Enter 提交 → `sessionStorage` 存 seed → `nav('chat')` 跳转 → `Chat.tsx` 挂载读 seed 并 sendText。seed 一次性消费（`ui/lib/chatSeed.ts` 的 `popChatSeed`），React 18 严格模式重挂载用 ref 防重发。

## 真机 Smoke Check

1. `pnpm dev:gateway`
2. debug bundle：`cd apps/shell && pnpm tauri build --debug --bundles app`（MCP/自动化验收需要 bundle 注册 LaunchServices）
3. `PETSONA_HARNESS_CMD="node <repo>/packages/harness/dist/main.js" ./apps/shell/src-tauri/target/debug/bundle/macos/Petsona.app/Contents/MacOS/petsona-shell`
4. 任意邮箱登录，开发验证码 `888888`。
5. 桌宠：单击 → 播 wave 动作、双击 → 开主面板、拖拽 → 触发 wave 且整窗跟手。
6. 面板：Enter 输入框跳转对话页并发送；提醒页免打扰设置弹自绘对话框；记忆页编辑/删除/清空弹自绘对话框。
7. 提醒：番茄钟开启 → 25min 后 REMINDER_FIRED 走宠物气泡；勿扰时段内被押回。
8. worker 审批闭环（mock LLM）：
   `@tool dispatch_task {"goal":"@tool fs_write {\"path\":\"<scope内路径>\",\"content\":\"x\"}","agentType":"worker","scope":{"dirs":["<scope目录>"],"net":false}}`
   → 设置中心 → 审批与撤销 → 批准 → 验证文件 → 撤销 → 验证恢复。

## 已知边界

- `shell` 仍是即时执行工具（scope/permission/audit + builtin L3），命令级 staging 未设计。
- 审批页入口在 设置中心 → 审批与撤销（首页四卡不含审批，Figma IA 如此）。
- AudioProvider（M4）未启用。
- 生产邮件服务、Redis/Postgres 网关存储、sidecar 打包签名、正式美术剩余表情/道具资产未完成。
- 记忆管理页只支持整条 body 编辑（先 `MEMORY_GET` 拉全文再改），部分批量操作走「清空分类」而非多选。

## 关键文件

- `README.md` / `CLAUDE.md` / `SPEC-GAPS.md` — 快速开始 / Agent 规则 / 规格空白决策。
- `docs/M2_TASK_BOARD.md` — M2 任务板、子 Agent、staging、审批、undo 机制与验收说明。
- `packages/harness/src/scheduler/README.md` — M3 调度器实现要点（cron/间隔/持久化/心跳/守卫）。
- `docs/superpowers/plans/2026-07-03-m3-scheduler.md` — M3 实现计划备查。
- `apps/shell/ui/panel/kit.tsx` — 面板通用组件 + `useDialog()`（面板窗任何弹层必须走这里，禁 `window.prompt/confirm/alert`）。
- `apps/shell/ui/pet/PetWindow.tsx` — 桌宠单击/双击/拖拽 + wave 计时；宠物窗窗口尺寸 180×200。
- `apps/shell/src-tauri/capabilities/default.json` — Tauri v2 ACL（event/listen + start-dragging）。
- `apps/shell/src-tauri/src/lib.rs` — 面板窗尺寸（`PANEL_WIDTH/HEIGHT` = 440×560）、浮窗、装配。
- `packages/harness/src/main.ts` — IPC 路由、任务板、审批/撤销、调度器/心跳装配。
- `packages/harness/src/gateway/client.ts` — 唯一网络出口：auth/chat/proxyFetch/401 自动刷新。
- `apps/gateway/src/routes/proxy.ts` — web_fetch 代理端点（SSRF 防护）。
- `packages/assets/skills/` — 4 个 ready 技能 + INDEX。

## 建议下一步

1. M4 AudioProvider 开工（TTS 通道 + 唤醒词）。
2. 生产化：邮件服务真接、Redis/Postgres 存储替换单机 Map、sidecar Node SEA/pkg 打包与签名（v3.0 A.4）。
3. 面板 CSS 拆分：`apps/shell/ui/panel/panel.css` 已 858 行，按页拆到 5 个 CSS 或迁 CSS Modules。
4. 剩余美术：表情帧、场景道具（v3.0 A.4）；给 sleep 姿势补 HEVC-alpha .mov（现回落 sit）。

审批闭环回归可用 `node scripts/probe-dispatch.mjs`（起网关后 15 秒内应打印 `TASK_EVENT awaiting_approval`）。

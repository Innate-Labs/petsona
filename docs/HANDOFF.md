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

## 第四轮：真接 LLM + BYOK + 密码登录 + reasoning（2026-07-03）

1. **DeepSeek 接入**：`apps/gateway/src/load-env.ts`（Node 22 `process.loadEnvFile()` try/catch，`server.ts` 首行 import）+ `.env`（`.gitignore` 已忽略）；缺省模型 `deepseek-v4-flash`（reasoning 系）；`AUTH_STORE_FILE=./.auth-store.json` 让 refresh 白名单 + 密码 hash 跨热重载存活（tsx watch 每次改代码不再吞登录态）。
2. **Reasoning 模型全链路**（观察于 `deepseek-v4-flash` 的 `delta.reasoning_content` 流式协议）：
   - `packages/shared`：`LlmContentBlock` 加 `{type:'reasoning', text}`；新 `LlmSseReasoning`；`IPC.CHAT_REASONING` + `ChatReasoningPayload`。
   - `apps/gateway`：`ProviderChunk` 加 `reasoning` 变体；`openai_compat.ts` 流式/非流式都读 `reasoning_content`；`routes/llm.ts` 派 SSE `event: reasoning`（**不 recordUsage**，避免与末帧 usage 双记）；`openai_convert.fromOaiMessage` 前置 reasoning 块。
   - `packages/harness`：`ChatStreamCallbacks.onReasoning`；SSE 分派加 `case 'reasoning'`；companion.ts `emit(CHAT_REASONING)`（reasoning 不入 `roundText` 也不回喂模型）。
   - `apps/shell/ui`：`ChatMsg.reasoning: boolean`（用户决定思考流不外露）；`reasoning && !text` 时渲染「{petName} 正在来的路上…」；发送即时 loading（`useChat.sendText` 立插 pending 宠物占位，`CHAT_SEND` res 到再 rekey，首字延迟从 500-2000ms 压到 0）；空 pill 条件短路防"只显示光标"。
3. **BYOK（Bring Your Own Key）**：
   - `IPC.LLM_KEY_GET/SET/CLEAR`（GET 只回 `{hasKey, maskedTail}` 防明文回带）；
   - `GatewayClient` 加 `userLlmApiKey` 内存缓存 + Keychain 存取（account=`userLlmApiKey`，同 `dev.petsona.app` service）+ chat 请求带 `x-petsona-user-llm-key` header；
   - 网关 `factory.createProvider(tier, {apiKeyOverride})` — override 有值时 **不缓存**，一次性构造，防跨请求泄漏；
   - 设置页 AI 模型密钥分区：粘贴 → 保存到 Keychain；已有时展示末四位 `****xxxx`。
4. **邮箱 + 密码单步登录**（替换 UI 验证码流；`/v1/auth/login` 双路径保留 code 让 auth.flow.test 兼容）：
   - `apps/gateway/src/auth/password.ts` 新增 scrypt（Node stdlib，salt.hex.hash.hex，`timingSafeEqual`）；
   - `User.passwordHash?` 落盘 `AUTH_STORE_FILE`；`setUserPassword` 首次登录写 hash（不覆盖）；
   - `/v1/auth/login` 接受 `{code}`（老）或 `{password}`（新）；密码路径：无 hash 首次视为"登录即注册/认领"、有 hash 走 `verifyPassword` → 401 `INVALID_CREDENTIALS`；
   - `LoginSubmitPayload.password?`；`GatewayClient.submitPassword`；`main.ts:LOGIN_SUBMIT` 按 payload 分派；
   - `Login.tsx` 全重写为邮箱 + 密码单表单，无发送环节。
5. **设置中心重设计**（`apps/shell/ui/ManagementPanel.tsx` + `styles.css` 新分区样式）：AI 模型密钥 / 陪伴节奏（友好化"多久主动找我一次"）/ 文件权限 / 账号（登录邮箱 + 退出）/ 快捷入口（审批 & 记忆）/ 进阶（`gatewayUrl` 折叠）。
6. **App 图标**：从 `apps/shell/ui/assets/characters/final-pet/sit.mov`（HEVC-alpha）用 `qlmanage -t -s 1024` 抽第 0 帧 → `sips -c 768 768` 中心裁剪保留耳朵→脚 → `-z 1024 1024` → 生成 10 尺 iconset → `iconutil -c icns` → 装两处：`src-tauri/icons/icon.png` 源图（下次 tauri:build）+ `Petsona.app/Contents/Resources/AppIcon.icns` + `Info.plist` 加 `CFBundleIconFile=AppIcon`。**关键坑**：cargo debug 出的 .app 签名是 `adhoc linker-signed`（`Info.plist=not bound`）；改 plist 后 macOS 判"tampered" → Finder 显示蓝图模板兜底。必须 `codesign --force --deep --sign - Petsona.app` 重签 + `killall Dock` + `lsregister -f` 让 LaunchServices 重读。
7. **`jiumi` 终端启动器**（用户级 `~/.zshrc` shell 函数，非仓库文件）：`jiumi` 常规启动、`jiumi --logout` 清 Keychain token 后重启（用于看新登录页）、`jiumi --restart` 只重启、`jiumi --status` 只报状态。

## UI 真机验收修复（三~七轮，2026-07-03，以下为最终定型状态）

宠物透明底先解决：原始 VP9-alpha webm 在 WKWebView 必黑底，改用 ffmpeg 转 HEVC-alpha .mov 接入五姿势（sit/wave/yawn/stretch/cheer），Sprite onError 自动降级图集兜底。随后经三~七轮迭代把交互与面板定型（逐轮过程见 git log `fix(shell): 第N轮`）：

1. **面板窗弹层**：Tauri（macOS WKWebView）默认不实现 `window.prompt/confirm/alert`（静默返回 = 按钮点了没反应）。`ui/ModalKit.tsx` 提供 `<ModalHost>` + `useDialog()`（prompt/confirm/alert，ESC + 遮罩取消、Enter 提交、autoFocus；prompt 支持 options 下拉 / inputType date·number·time / suggestions datalist）。`ManagementPanel.tsx` 统一挂载。**硬约束**：面板窗任何弹层都走 `useDialog()`，不得直接调 window.\*。
2. **桌宠交互最终契约**（`ui/pet/PetWindow.tsx`）：单击 → 在 `yawn/stretch/cheer` 三动作间轮换播放；双击 → 打开主面板；拖拽（位移 >4px）→ 整窗跟手并播 `wave`（拖拽专属，别处不放）；右下角悬停出 🐾 手柄 → `startResizeDragging` 系统级窗口角缩放。**动作播放期锁定**：`actionTimer` 存活时点击/拖拽都不换动作，播完回落情绪姿势。待提醒到点也在此窗弹气泡（见下条提醒页）。
3. **宠物动作视频防空窗定案**（`ui/pet/Sprite.tsx`，踩了四轮的坑，改前必读文件头注释）：全部姿势视频**常驻挂载、元素终身不重建**（重建即重加载即空窗，WKWebView 铁律），但**只有 active 一路解码播放，其余 pause 并停在第 0 帧**。历史雷区：a) key 换源重挂载 → 必空窗；b) 双缓冲垫底元素换 key → 照样重挂载；c)「起播超时判坏源」看门狗 → 冷启动首载被误伤、永久回退旧草稿图集；d) 全员同播 → 5 路 HEVC-alpha 双层解码卡顿 + 隐藏层循环到中段被切出来闪帧重放。
4. **桌宠窗可缩放**（`src-tauri/src/pet_window.rs`）：`to_panel` 会整体覆盖 style mask，`NONACTIVATING_PANEL | RESIZABLE` 必须一起设；min 120×140 / max 640×700；`pet-window.json` 增存 `w/h`（serde default 兼容旧文件），Moved/Resized 双事件全量落盘；CSS `.pet-window .sprite` 随窗缩放。
5. **主面板贴桌面窗口**：`styles.css` `.panel-shell` 撑满，限宽 420 只在浏览器原型（`body[data-host=web]`，main.tsx 打标）生效——断点方案会在窗口最大化时误伤留白；`lib.rs` `PANEL_WIDTH=440 PANEL_HEIGHT=640` + `min_inner_size` 同值锁死（主页内容实高 ≈607，560 必出滚动条）；去掉页内右上角 X（macOS 红绿灯已有关闭）。
6. **主页快捷输入框**：`ManagementPanel.tsx` 底部 `.home-quick`，Enter → `sessionStorage` 存 seed → 切到对话页并 sendText（`ui/lib/chatSeed.ts` 的 `popChatSeed` 一次性消费，ref 防严格模式重挂载重发）。
7. **提醒页**：三张卡的时长点击可调（弹时长选项写回 `config.reminders`，water/stand 调度器实时读即时生效、pomodoro 进行中自动 STOP+SET 重启会话）；免打扰时段改开始/结束两个下拉（半小时粒度，不再手写）；「Todo」改名「待提醒」，到点由宠物窗气泡提示（`PetWindow` 每 30s 轮询 localStorage todos，`TodoItem.notifiedOn` 同日去重、10 分钟宽限、错过不补发）。
8. **宠物数据页全字段可编辑**（`ui/ManagementPanel.tsx`）：种类/性格行内原生下拉；品种按种类给 datalist 建议且可自填；年龄常用建议可自填；体重数字输入；驱虫/疫苗原生日期选择器；所有行单击即编辑。

## 真机 Smoke Check

1. `pnpm dev:gateway`
2. debug bundle：`cd apps/shell && pnpm tauri build --debug --bundles app`（MCP/自动化验收需要 bundle 注册 LaunchServices）
3. `PETSONA_HARNESS_CMD="node <repo>/packages/harness/dist/main.js" ./apps/shell/src-tauri/target/debug/bundle/macos/Petsona.app/Contents/MacOS/petsona-shell`
4. 任意邮箱 + 任意 ≥6 位密码登录（首次即注册；老验证码路径仍可用：验证码字段填 `888888`，见 auth.flow.test）。
5. 桌宠：单击 → 在 yawn/stretch/cheer 三动作间轮换（播放期不被打断）、双击 → 开主面板、拖拽 → 播 wave 且整窗跟手、悬停右下角 🐾 手柄 → 拖拽缩放（重启后尺寸/位置恢复）。
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
- `apps/shell/ui/ModalKit.tsx` — 面板通用组件 + `useDialog()`（面板窗任何弹层必须走这里，禁 `window.prompt/confirm/alert`）。
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
3. 面板 CSS 拆分：`apps/shell/ui/styles.css` 已包含面板与提醒页样式，后续可按页拆到 5 个 CSS 或迁 CSS Modules。
4. 剩余美术：表情帧、场景道具（v3.0 A.4）；给 sleep 姿势补 HEVC-alpha .mov（现回落 sit）。

审批闭环回归可用 `node scripts/probe-dispatch.mjs`（起网关后 15 秒内应打印 `TASK_EVENT awaiting_approval`）。

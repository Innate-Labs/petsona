# 宠格 Petsona · 桌面版

macOS 桌面常驻的「上班搭子」宠物：人格聊天 + 记忆 + 任务板 + 审批式文件改动。
唯一规格真源：《桌面版开发规格说明书 v3.0》；本仓库已完成 M1「会陪」，M2 任务板主链路已接入。

## 架构

```
壳 Tauri v2（NSPanel 宠物窗 + 面板 + 托盘 + watchdog）
   ⇅ NDJSON over stdio（Envelope §3.0）
本地 Harness（Node sidecar：陪伴循环 s01 + 8 轻工具 + hooks s04 + 记忆 s09 + 压缩 s08）
   ⇅ HTTPS（唯一出口 gateway/client.ts，缝①）
云网关（Fastify：/v1/llm/chat SSE + /v1/auth/* + /v1/memory/sync + /v1/track/batch）
```

## 目录

- `packages/shared` — 协议类型唯一真源（壳/harness/网关只 import 不复制）
- `packages/harness` — 本地运行时（sidecar）
- `packages/assets` — 首装拷贝到 $DATA 的技能/人格/兜底文案池
- `apps/shell` — Tauri 壳（src-tauri Rust + ui React）
- `apps/gateway` — 云网关
- `tests` — 结构性约束 / 工具契约 / M2 任务板与 staging / Gate ①②③⑤ 自动化（helpers 含 mock 网关）
- `docs/M2_TASK_BOARD.md` — M2 任务板、子 Agent、staging、审批、undo 机制与验收
- `docs/HANDOFF.md` — 当前交接状态、真机 smoke check、下一阶段入口

## 快速开始

建议使用 Node 22.x；当前依赖 `better-sqlite3@11.10.0` 与 Node 26 native ABI 不兼容。

```bash
pnpm install
pnpm build                 # shared → harness → gateway

# 终端 1：网关（默认 8787，Mock LLM）
pnpm dev:gateway

# 终端 2：桌面 App（自动 spawn harness sidecar）
cd apps/shell && pnpm tauri:dev
```

登录：任意邮箱 + 验证码 `888888`（dev 固定码，正式码打印在网关日志）。

### 只调 UI（不起壳/harness）

```bash
pnpm --filter @petsona/shell dev   # 浏览器打开 5173，走内置 mock 总线
```

## 接入真实 LLM（DeepSeek / 任意 OpenAI 兼容 / Anthropic）

网关 env（`apps/gateway/.env` 或环境变量）：

```bash
LLM_PROVIDER=openai                    # mock | openai | anthropic（缺省 mock）
LLM_MAIN_BASE_URL=https://api.deepseek.com
LLM_MAIN_API_KEY=sk-...
LLM_MAIN_MODEL=deepseek-chat
LLM_CHEAP_BASE_URL=https://api.deepseek.com   # cheap 档（打标/摘要/气泡压缩）
LLM_CHEAP_API_KEY=sk-...
LLM_CHEAP_MODEL=deepseek-chat
```

密钥只进网关；harness/壳零密钥（token 存 macOS Keychain，service=`dev.petsona.app`）。

## 测试

```bash
pnpm test        # 全量：结构性约束/工具契约/任务板/staging/合规/Gate
```

- **结构性约束（§10）**：companion 禁注册重工具、builtin L3 不可降级、harness 网络出口唯一、vendor SDK 隔离、token 禁落盘
- **M1 Gate**：① 登录→流式聊天 ② 断 LLM 兜底文案轮换 ③ 重启记忆三层存活 ④ IPC 全消息表（占位可） ⑤ hooks 全挂载 ⑥ 即上面结构性约束
- **M2 任务板单测**：`tests/unit/tasks.board.test.ts` 覆盖落盘、worker 串行、TASK_EVENT、取消与 scope 拦截。
- **M2 staging 单测**：`tests/unit/staging.store.test.ts` 覆盖 staged write/trash、apply 和 undo；`tests/unit/subagent.executor.test.ts` 覆盖 subagent tool loop。
- 测试环境变量：`PETSONA_KEYCHAIN=memory`（避免弹钥匙串）、`PETSONA_DATA_DIR`（隔离数据目录）
- 当前机器若使用 Node 26，sqlite-backed tests 会因 `better-sqlite3` ABI 不匹配失败；使用 Node 22 跑全量。

## $DATA 布局

`~/Library/Application Support/Petsona/<userId>/`（dev 可用 `PETSONA_DATA_DIR` 覆盖）：
config.json / persona.json / skills/ / personas/ / memory/{MEMORY.md,cold/*.md,sessions.db} /
tasks/ / staging/ / plans/ / undo/ / scheduled.json / outputs/ / logs/audit.jsonl —— 全部人类可读可备份。

## 当前范围与后续

- M1 shell 收尾已包括桌宠位置恢复和真机快捷聊天浮窗；手动验收步骤见 [docs/HANDOFF.md](docs/HANDOFF.md)。
- M2 任务板主链路已接入：`dispatch_task` 写入 `$DATA/tasks/task_*.json`、广播 `TASK_EVENT`、支持 `TASK_CANCEL`；worker/explore 子 Agent 通过 `meta.loop=subagent` 执行；文件写入/移动/重命名/回收先 staging，审批后 apply，undo journal 可恢复。
- `PLAN_GET`、`APPROVAL_DECISION`、`UNDO_REQUEST` 已在 harness 实现；shell Approval 面板已有最小列表/详情/批准/部分批准/拒绝/撤销交互。细节见 [docs/M2_TASK_BOARD.md](docs/M2_TASK_BOARD.md)。
- `web_fetch` 已接 gateway `/v1/proxy/fetch` 代理（SSRF 防护，harness 网络出口唯一）；4 个 M2 技能（organize_files/clean_trash/find_stuff/screen_qa）已交付 ready 正文。
- 2026-07-02 真机验收通过：登录/聊天/拖动恢复/浮窗 + worker 审批闭环（批准应用、撤销恢复）；修复清单见 [docs/HANDOFF.md](docs/HANDOFF.md)。
- 调度器/心跳只有目录与类型（M3）；dream() 空实现（M3）；AudioProvider 未启用（M4）。
- 规格未覆盖处的实现决策见 [SPEC-GAPS.md](SPEC-GAPS.md)（交付 review 后回填规格）。
- GitHub 远程：**尚未推送**——本地 main 分支已按模块 conventional commits，等仓库地址就绪后 `git remote add origin <url> && git push -u origin main`。

# 宠格 Petsona 桌面版交接

本仓库当前交付 M1「会陪」：macOS 桌宠壳、本地 harness、可 mock 的云网关。M2 尚未开工。

## 当前状态

- `pnpm build` 可通过。
- `pnpm --filter @petsona/shell build` 可通过。
- `pnpm test` 在允许本机 loopback 网络后可通过；端到端用例会启动 mock 网关。
- `pnpm --filter @petsona/shell tauri:dev` 可启动 Tauri 桌面 App；登录和聊天需要另起网关。
- M1 shell 收尾已包含桌宠位置恢复和 Tauri 快捷聊天浮窗。

## 真机 Smoke Check

1. 启动网关：

   ```bash
   pnpm dev:gateway
   ```

2. 启动桌面 App：

   ```bash
   pnpm --filter @petsona/shell tauri:dev
   ```

3. 任意邮箱登录，开发验证码用 `888888`。
4. 发送一条聊天消息，确认流式片段最终合成一条回复。
5. 拖动桌宠，退出并重启，确认桌宠恢复到上次仍在屏幕内的位置。
6. 打开桌宠菜单并点击「聊天」，确认快捷聊天浮窗在桌宠附近打开，关闭按钮能隐藏浮窗。

## 已知边界

- `dispatch_task` 仍是占位，返回「M2 才会干活喵」。
- 任务、审批、staging、undo、重工具执行属于 M2。
- 调度 tick、主动心跳、全屏静默、记忆 Dream、记忆管理 UI 属于 M3。
- AudioProvider 属于 M4。
- 生产邮件服务、Redis/Postgres 网关存储、sidecar 打包签名、正式美术资产尚未完成。
- 全屏检测当前恒返回 `false`，位置在 `apps/shell/src-tauri/src/macos/idle.rs`。

## 关键文件

- `README.md` - 人类快速开始、LLM 配置、测试与 M1 范围。
- `CLAUDE.md` - Agent 规则、架构硬边界、命令速查。
- `SPEC-GAPS.md` - 规格空白、当前默认决策和待回填建议。
- `apps/shell/src-tauri/src/lib.rs` - Tauri app 装配、面板窗口、快捷聊天浮窗。
- `apps/shell/src-tauri/src/pet_window.rs` - 桌宠 NSPanel 和位置持久化。
- `apps/shell/ui/DESIGN.md` - Figma 派生 UI 规格、视觉 token、实现取舍。
- `packages/harness/src/main.ts` - IPC 消息注册和 M2/M3 占位。
- `packages/harness/src/tools/light/index.ts` - M1 轻工具和占位 `dispatch_task`。

## 建议下一步

1. 在具备辅助功能权限的 Mac 上完成真机 smoke check。
2. 从 M2 任务板开始：`$DATA/tasks/` 任务记录、单 worker 并发、`TASK_EVENT`、取消。
3. 任务板稳定后接 staging、审批和 undo。
4. 将 `packages/assets/skills/` 下 draft 技能替换为正式 M2 技能。

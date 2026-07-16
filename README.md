<p align="center">
  <img src="assets/readme/petsona-cat.png" width="240" alt="宠格 Petsona 小猫形象"/>
</p>

<h1 align="center">宠格 Petsona</h1>

<p align="center">
  <b>一款陪伴你、也能帮你干活的 macOS 桌面 AI 宠物</b><br/>
  <sub>会聊天 · 有记忆 · 能主动关心你 · 会审批式地帮你整理文件</sub>
</p>

---

## 🐾 它是什么

宠格 Petsona 是一只常驻你 macOS 桌面的 AI 小宠物。它不是纯观赏摆件，而是一个真能帮你干活的桌面 Agent：

- 像跟朋友一样跟它聊天，接你自己的 DeepSeek key（也可以用管理员默认）。
- 它会记住你说过的偏好、日常习惯，聊得越久越懂你。
- 它会在你专注、久坐、久没喝水的时候主动出现（可关，可设勿扰时段）。
- 它想动你桌面/下载里的文件，必须先给你看改动草稿，你点通过它才真的落盘——并且能一键撤销。

## ✨ 主要功能

### 陪伴与聊天
- 桌面常驻小猫：单击换动作 / 双击开面板 / 拖拽跟手挥手 / 右下角 🐾 手柄缩放窗口
- 邮箱 + 密码单步登录（首次填即注册），流式回复
- 支持 DeepSeek（含 reasoning 系 `deepseek-v4-flash` / R1）、任意 OpenAI 兼容上游、Anthropic
- 情绪机：随对话切换宠物姿态；思考型模型「正在来的路上…」占位反馈

### 记忆
- 三层记忆结构：热对话 → 温热档案 → 冷长期记忆
- 记忆管理页可查看 / 编辑 / 删除 / 分类清空
- 夜间「Dream」自动压缩合并 + 索引重建，第二天精简干净

### 帮你干活（任务板 + 审批式改文件）
- 交给它一个目标，它拆解成计划 → 执行 → 你审批 → 才落盘
- 想改的每个文件都以「暂存草稿」形式先给你看
- 撤销按钮可恢复到执行前的原始内容
- 内置 4 个技能：整理文件 / 清理回收站 / 查东西 / 屏幕问答（macOS Vision OCR）
- 8 个轻工具（读上下文、记备忘、发提醒、fetch 网页等）

### 提醒与守卫
- 每 30 秒调度一次，到点主动气泡提醒
- 番茄钟 / 喝水 / 起来动动 三条提醒线可配
- 免打扰时段、你在全屏工作 / 看视频时它自动闭嘴
- 提醒时长在设置里可调

### 隐私与安全
- 所有密钥（登录 token、你的 LLM API key）只进 macOS Keychain，永不落磁盘
- 本地数据在 `~/Library/Application Support/Petsona/`，人类可读，随时可备份或删
- Harness 侧禁止直连外网，网络出口只走唯一云网关
- 「删」都不用 `rm`，走回收站或 undo journal

## 🚀 快速上手

**目前是开发预览阶段，需要克隆源码本地跑（安装包尚未打包分发）。**

```bash
git clone https://github.com/Innate-Labs/petsona.git
cd petsona
pnpm install
pnpm build

# 终端 1：起云网关（:8787）
pnpm dev:gateway

# 终端 2：起桌面 App
cd apps/shell && pnpm tauri:dev
```

打开 App 后：邮箱 + ≥6 位密码登录 → 面板「设置中心」→ 填你自己的 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 领取）→ 回到聊天页跟它说话就行。

想给所有用户配全局默认 key（BYOK 未填时的兜底），在 `apps/gateway/.env` 里配 `LLM_MAIN_API_KEY` 等，见 [CLAUDE.md](CLAUDE.md)。

- 只调 UI（不起壳/harness，浏览器 mock 总线）：`pnpm --filter @petsona/shell dev`
- Node 版本要 **22.x**（`better-sqlite3@11.10.0` native binding 要求）

## 🗺 路线图

**已交付**：
- ✅ **M1 会陪** —— 登录 / 流式聊天 / 情绪机 / 桌宠拖动与位置恢复 / 快捷浮窗
- ✅ **M2 会干** —— 任务板 + 子 Agent + 文件类工具暂存审批 + undo journal + 4 技能 + gateway 代理网络出口
- ✅ **M3 会提醒·会梦** —— 30s 调度器 + 心跳 + 三条提醒线 + 夜间 Dream 记忆压缩 + 记忆管理页 + macOS 全屏检测 + 匿名→登录目录迁移
- ✅ **2026-07-03 第四轮** —— 真接 DeepSeek + reasoning 模型全链路（v4-flash / R1）+ BYOK 用户自带 key + 邮箱密码单步登录 + 设置中心 6 分区重设计 + 宠物图标（宠物角色 sit.mov 抽帧）

**规划中**：
- 🚧 **M4 语音** —— AudioProvider（TTS 朗读 + 唤醒词 STT）
- 🚧 **打包分发** —— sidecar Node SEA/pkg 打包 & 签名，用户下载 .dmg 即用（不再需要克隆源码）
- 🚧 **改密码 / 找回密码流程** —— 目前只支持首次注册即登录
- 🚧 **生产化** —— 真实邮件服务 + Redis/Postgres 存储替换单机内存 Map
- 🚧 **美术补齐** —— 表情帧、场景道具、sleep 姿势 HEVC-alpha .mov
- 🚧 **Windows / Linux 移植** —— 现只跑 macOS（Tauri 底子已跨端，但 NSPanel 宠物窗与 macOS Vision OCR 是 mac 专属）

## 🛠 技术架构

```
壳 Tauri v2（NSPanel 宠物窗 + 面板 + 托盘 + watchdog）
   ⇅ NDJSON over stdio
本地 Harness（Node sidecar：陪伴循环 + 8 轻工具 + hooks + 三层记忆）
   ⇅ HTTPS（唯一出口）
云网关（Fastify：/v1/llm/chat SSE + /v1/auth/* + /v1/memory/sync + /v1/track/batch）
```

- **前端壳**：Tauri 2（Rust）+ React 18 + Vite
- **本地运行时**：Node 22 sidecar + better-sqlite3（三层记忆存储）
- **云网关**：Fastify + jsonwebtoken（JWT）
- **LLM**：不用任何 vendor SDK，直接 fetch OpenAI 兼容 API；reasoning 模型全链路（`reasoning_content` 独立 SSE 事件 → IPC → UI loading）
- **测试**：Vitest，覆盖结构约束 / 工具契约 / 任务板 / staging / Gate ①②③⑤ 等 164 用例

深入了解：
- [快速开始与开发指南 · CLAUDE.md](CLAUDE.md)
- [架构交接与真机验收清单 · docs/HANDOFF.md](docs/HANDOFF.md)
- [M2 任务板机制 · docs/M2_TASK_BOARD.md](docs/M2_TASK_BOARD.md)
- [规格空白决策 · SPEC-GAPS.md](SPEC-GAPS.md)

## 📄 License

暂未选定开源 License；使用 / 二次开发前请联系 Innate Labs。

---

<p align="center"><sub>Made with 🐾 by <b>Innate Labs</b> · macOS-only · 2026</sub></p>

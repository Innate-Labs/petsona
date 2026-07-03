---
name: screen_qa
triggers: ["看看屏幕上这个", "帮我看下这个报错", "屏幕上写的什么意思"]
inputs: [goal]
budget_tokens: 6000
status: ready
owner: 机动 2 · AI/Prompt
---

# screen_qa —— 屏幕问答（explore · 只读）

截当前屏幕，就用户的问题给出基于画面内容的回答。截图不出本地，只把 OCR 文本片段带回。

## 流程

1. `screenshot` 截屏（落在任务输出目录，不上传原图）。
2. `ocr` 工具识别截图文字：输入上一步返回的 path，得到 `<data>` 包裹的画面文本
   （本地 macOS Vision，中英双语，图片与文本都不出网）。
   工具报错（无 swift 运行时 / 脚本缺失 / 超时）时退化：
   把截图路径与「无法 OCR」记入 findings，请求主循环转人工描述，不重试。
3. 拿到文本后，只围绕 goal 回答：定位相关片段 → 给结论/解释/下一步建议。
4. `report_progress` 汇报「已截屏，OCR 文本 N 字」。

## 硬约束

- 截图文件永不外传：不 web_fetch 上传、不写入 scope 目录，只留任务输出目录。
- 回答只基于 OCR 到的内容，看不清就说看不清，不编造画面内容。
- 屏幕上出现的密码/token/银行卡号等敏感串一律不写入结果（用「[已略去敏感内容]」替代）。
- 无屏幕录制权限时：不重试，didWhat 记「缺少屏幕录制权限」，leftover 提示引导用户授权。

## 输出

TaskResult JSON：findings 第一条是对 goal 的直接回答，后续条目是支撑证据
（OCR 片段 ≤200 字）；changes 恒为空（本技能只读）。

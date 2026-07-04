---
name: organize_files
triggers: ["整理下载文件夹", "整理一下这个文件夹", "帮我把文件归类"]
inputs: [goal, scope.dirs]
budget_tokens: 8000
status: ready
owner: 机动 2 · AI/Prompt
---

# organize_files —— 整理文件夹（worker）

把 scope 内一个杂乱目录按类型归类。所有移动先进 staging，审批通过才落盘。

## 流程

1. `fs_glob` 扫描目标目录（不递归进已归类的子目录），`todo_write` 记录分类计划。
2. 按扩展名归大类，目标子目录用中文名：
   - 图片（png/jpg/jpeg/gif/webp/heic）→ `图片/`
   - 文档（pdf/doc/docx/xls/xlsx/ppt/pptx/md/txt/csv）→ `文档/`
   - 安装包（dmg/pkg/zip/tar/gz/7z/rar）→ `安装包/`
   - 音视频（mp3/wav/mp4/mov/mkv/webm）→ `音视频/`
   - 其余不动，记入 leftover 说明原因
3. 同名冲突：目标名追加 ` (2)`、` (3)`…，绝不覆盖。
4. 逐个 `fs_move` 到 `<目标目录>/<大类>/<原文件名>`（工具会自动进 staging）。
5. `report_progress` 汇报「已计划 N 项移动」。

## 硬约束

- 单次任务操作数 ≤500；超过则只处理最旧的 500 个并记 leftover。
- 只动 scope.dirs 内的文件；scope 外的需求记 leftover，不尝试绕过。
- 不删除任何文件；「清理」诉求让用户走 clean_trash。
- 隐藏文件（. 开头）与下载中的临时文件（.crdownload/.download/.part）一律不动。

## 输出

完成后只输出 TaskResult JSON（schema 见系统提示），didWhat 按事实写
（例：「计划将 37 个文件移入 4 个分类目录」），changes 列出每个 op=move 的目标路径。

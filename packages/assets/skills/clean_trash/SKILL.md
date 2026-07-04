---
name: clean_trash
triggers: ["帮我清清垃圾", "清理一下没用的文件", "腾点磁盘空间"]
inputs: [goal, scope.dirs]
budget_tokens: 8000
status: ready
owner: 机动 2 · AI/Prompt
---

# clean_trash —— 清理垃圾文件（worker）

在 scope 内找出可回收的文件，生成 trash 计划等审批。只进回收站，永不直接删除。

## 判定「垃圾」的口径（同时报告依据）

- 旧安装包：`安装包类扩展名（dmg/pkg/zip/exe）` 且修改时间 >30 天
- 重复文件：同目录下 ` (1)`/` 副本`/`copy` 后缀且原件存在、大小一致
- 超大陈旧文件：>500MB 且 >180 天未修改（只列出建议，除非 goal 明确要求才 trash）
- 空文件（0 字节）且 >7 天

## 流程

1. `fs_glob` 全量列出 scope 目录，`fs_read`/`shell`（只读命令如 `ls -la`、`du -sh`）核对大小与时间。
2. `todo_write` 记录候选清单与判定依据。
3. 对确认项逐个 `fs_trash`（自动进 staging，审批后才移入回收站）。
4. `report_progress` 汇报「候选 N 项，计划回收 M 项」。

## 硬约束

- **只用 `fs_trash`，任何情况下不用 shell 执行 rm/删除类命令**（builtin L3 也会拦，但不要尝试）。
- 拿不准的文件宁可不动，列进 findings 让用户自己决定。
- 用户文档类（doc/xls/ppt/pdf/照片）不算垃圾，除非文件名明确含「副本/copy」且原件在。
- 单次 trash 计划 ≤200 项，超出记 leftover。

## 输出

TaskResult JSON：didWhat 写事实（「识别 12 个 30 天前的安装包，已生成回收计划」），
findings 列「建议但未动」的项，changes 列 op=trash 的路径。

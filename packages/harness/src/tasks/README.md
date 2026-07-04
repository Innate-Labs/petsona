# tasks（M2 任务板）

类型见 @petsona/shared task.ts（TaskRecord/TaskEvent/TaskResult）。

已落地：
- `board.ts`：s12 任务板，落盘 `$DATA/tasks/task_*.json`；dispatch scope 白名单校验（`~` 展开）
- 状态机：`queued -> running -> completed/failed`，文件改动走
  `running -> awaiting_approval -> applying -> completed | rejected`；
  `queued/running/awaiting_approval -> cancelled`（终态另含 `timeout`）
- 并发：`worker x1 + explore x1`，超额排队
- `subagent.ts`：子 Agent 执行器——gateway LLM + subagent 重工具 registry + TaskResult schema 收口；
  staged 改动存在时最终摘要解析失败也照常进入审批（不丢计划）
- `TASK_EVENT` 广播（created/progress/awaiting_approval/result）与结果注入队列
- `TASK_CANCEL` 取消 queued/running/awaiting 任务

审批/undo 属 staging 模块（`../staging/store.ts`）；机制与验收见 docs/M2_TASK_BOARD.md。

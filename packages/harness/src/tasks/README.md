# tasks（M2 任务板）

类型见 @petsona/shared task.ts（TaskRecord/TaskEvent/TaskResult）。

已落地：
- `board.ts`：s12 简化任务板，落盘 `$DATA/tasks/task_*.json`
- 状态机：`queued -> running -> completed/failed/cancelled`
- 并发：`worker x1 + explore x1`
- `TASK_EVENT` 广播与任务结果注入队列
- `TASK_CANCEL` 取消 queued/running 任务

下一步接入：子 Agent 执行器、重工具、staging、审批、undo。

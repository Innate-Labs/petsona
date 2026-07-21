// TaskRunningNote.tsx —— 聊天框内的任务执行提示：统一「任务执行中」逐字跳动动画
// 为什么不展示工具/任务详情：详情追踪收敛到桌宠头顶状态灯（pet/TaskLight），聊天里只保留轻量动效不刷屏。

const LABEL = '任务执行中'

export function TaskRunningNote({ className }: { className: string }) {
  return (
    <div className={className} role="status" aria-label="任务执行中">
      <span className="task-running-wave" aria-hidden="true">
        {LABEL.split('').map((char, index) => (
          <span key={index} style={{ animationDelay: `${index * 0.12}s` }}>{char}</span>
        ))}
      </span>
    </div>
  )
}

# scheduler（M3 交付）

M1 只建目录与类型（v3.0 A.3）。类型见 @petsona/shared schedule.ts（CronJob/InjectionItem/SCHEDULER_TICK_MS）。
M3 落地：cron.ts（30s tick 读 scheduled.json → InjectionItem 入队）、heartbeat.ts（p01 空闲心跳 + p02 硬校验）。
调度器不直接调 LLM、不直接发气泡（§3.8）。

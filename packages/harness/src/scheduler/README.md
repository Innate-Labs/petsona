# scheduler（M3 已交付）

§3.8 落地。纯生产者：**不 import gateway、不 emit**（structural.test.ts 机器强制）。

- `cron_expr.ts` — 5 段 cron 匹配（零依赖，日/周同限取 OR）
- `jobs_store.ts` — scheduled.json 原子读写（只持久化 durable）
- `cron.ts` — 30s tick：cron 类到点/间隔类到期 → InjectionItem 入队；dream 走 onDream 回调（启动补跑 >20h）
- `guards.ts` — p02 硬校验纯函数（频控/勿扰/全屏），心跳与消费器共用
- `heartbeat.ts` — p01：SYS_IDLE_STATE 驱动，p02 双重校验，decide/isDuplicate 由 main.ts 注入（persona/proactive.ts，cheap 档）

消费两路（main.ts 接线）：
- `<reminder …/>` 条目 → `loop/reminder_consumer.ts` 循环空闲时文案池直出（REMINDER_FIRED + PET_BUBBLE）
- 其余（task/anniversary/custom）→ 既有 PreLLM injection_drain 进下一轮对话

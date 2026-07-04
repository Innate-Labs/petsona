---
name: find_stuff
triggers: ["上周那个 PDF 呢", "帮我找一下那个文件", "我记得有个叫 xx 的东西"]
inputs: [goal, scope.dirs]
budget_tokens: 6000
status: ready
owner: 机动 2 · AI/Prompt
---

# find_stuff —— 找东西（explore · 只读）

按用户模糊描述在 scope 内定位文件，返回路径与摘要。全程只读，不改任何文件。

## 流程

1. 从 goal 提取线索：文件名片段、类型、时间范围（「上周」= 7±3 天）、内容关键词。
2. 优先 `shell` 跑 `mdfind -onlyin <scope目录> '<关键词>'`（Spotlight 索引最快）；
   mdfind 无结果再 `fs_glob` 按扩展名/名字模式兜底。
3. 命中多个时按修改时间排序取前 10；对文本类候选 `fs_read` 前 2KB 提取摘要核对是否匹配描述。
4. `report_progress` 汇报「候选 N 个，已核对 M 个」。

## 硬约束

- 只读：只许 fs_read / fs_glob / shell 只读命令（mdfind/ls/stat/file）/ report_progress / todo_write。
- 不打开文件、不移动文件；「帮你打开?」的交互由主循环播报时提供，不在本技能内做。
- 搜索范围限 scope.dirs；用户描述指向 scope 外时记 leftover 提示需要授权。
- 二进制文件不 fs_read，摘要写「二进制文件（大小/时间）」。

## 输出

TaskResult JSON：findings 每项一行「路径 — 一句话摘要（修改时间）」，
按可能性排序；没找到时 didWhat 写实际搜索动作，findings 给最接近的候选并说明差距。

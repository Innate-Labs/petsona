# GUI 设计规格（源：Figma「测试」yfjW1ZFYfQdgRkLeZlOy4Y，经 Figma MCP 提取）

> 页面图 82:1881 / 组件库 25:2600。节点号可直接拼 URL 定位：`?node-id=<id 冒号换横线>`。
> 资产已落 `assets/figma/`（sprite-sheet.png 1774×887 = 4列×2行 443.5px 帧格）。

## Token

| 名 | 值 | 用途 |
|---|---|---|
| --bg-grad | linear-gradient(90deg,#fffdf8,#f7efe4) | 面板底/页头/页脚 |
| --card-bg | #f0e7dd | 首页方卡/提醒方卡 Normal |
| --card-active-grad | linear-gradient(~109deg,#c99b72,#e9bca0) | 卡片 Hover/选中、长按钮、FAB |
| --row-active | #f1ece6 | 列表行选中/设置卡底 |
| --text | #593200 | 主文字 |
| --text-sub | #8b6848 | 辅文字/页脚 |
| --panel-border | #e5d8c8 | 数据面板描边 |
| --chip-doing | #ffe4b3 | 状态「进行中」底（字 #8b6848） |
| --chip-off | #ffd9c3 | 「已关闭」底（字 #593200）；退出登录底（字 #ff7b7b） |
| --chip-on | #d5ffcf | 「已开启」底（字 #593200） |
| --float-grad | linear-gradient(180deg,#fff8ee,#fff2e0) | 对话浮窗底 |
| --float-border | #f3e0c8 | 浮窗描边/头像环描边 |
| --avatar-ring | #caa27f | 头像圆底 |
| --user-bubble | #f6ebdd | 用户消息气泡 |
| --input-shadow | 0 8px 4px #decdb4 | 超级输入框投影 |
| shadow-window | 0 14px 34px rgba(92,64,48,.16) | 面板整窗 |
| shadow-card | 0 12px 26px rgba(90,57,32,.12) | 卡片 |
| 浮窗内高光 | inset 0 5px 2px #fff + 圆角36 | 对话浮窗 |

字体 PingFang SC。字号：12(辅)/13(正文行)/14/16(行标题)/18(页标题/卡标题)/22(方卡题)/24(方卡数值)/32(大数字)。
圆角：卡 24 / 面板 16 / 行 16 / 浮窗 36 / 输入卡 27 / 药丸 999。

## 页面（帧 337×551；页头 50、页脚 24 皆 --bg-grad）

- **首页 82:2040**：页头「首页」变体=头像32(环#caa27f/#f3e0c8+sprite裁切)+名「糯米」+关闭；问候 18 Medium 两行；「已陪伴你」13 + 118(32 Medium)+天(18)；心情：🥳 开心(情绪chip)；右上宠物图150px(sprite帧+地面椭圆影)；2×2 方卡 148×135 (16/173,225/368)：宠物数据(icon+7.8kg 24px+副12+题18 Medium)/对话记录(渐变Hover态,32条)/提醒事项(14:22)/设置中心；卡icon=46圆底+24-32玻璃glyph。
- **宠物数据 82:2065**：页头子页变体(返回18+题+关闭)；可编辑头像50+「昵称: 糯米」18+编辑18+宠宠号12；数据面板 305×380 圆角16 border --panel-border：行52px=icon28+标签16 Medium+右值16 Regular 或下拉chip(白底56×28圆角999,字12 Medium+chevron12)，行间1px线；底部长按钮 305×52 渐变圆角999「重新上传宠物形象」18 Medium。行：宠物种类[小猫▾]/性格[温柔▾]/品种 布偶猫/年龄 2岁3月/体重 7.8千克/上次驱虫 2026·6·28/上次疫苗 2026·5·22。
- **对话记录 82:2237**：分区头 321×36「今日对话」16 Medium+展开btn18；会话行 321×36 圆角16：题13 左 2.49%缩进+右时间13；hover/选中=--row-active+删除icon28 替时间；分区线；「历史对话」同构。
- **提醒事项 82:2252**：4 方卡 148×126 圆角24（番茄钟=渐变态）：题22 Medium+值24(长值18)+状态chip54×28+「设置」白chip；Todo 分区头+行(checkbox16 圆角5 border --text、完成划线、时间13/删除28)；FAB 51px 渐变圆+白加号(19×3 双杠)，底距32 居中。
- **设置中心 82:2269**：卡 305×74 圆角24（开关桌宠=渐变+shadow 选中态，右上「🟢开启」白chip54×28）；行为变化频次[缓慢▾]/主动说话频次[中等▾]=--row-active 底+下拉chip；自定义宠物描述 305×132：--row-active 底+「编辑」白chip(56×28,字12+icon12)+正文12 justify；退出登录长按钮=--chip-off 底字#ff7b7b。
- **对话浮窗 Group12/13/54 (82:1931/1947/1974)**：300×425 圆角36 --float-grad+--float-border+内高光(选中态加 0 8px 16px rgba(0,0,0,.25))；头部50：头像32+历史icon18+关闭18；消息列 w268：宠物消息=无底 13 #593200；用户=--user-bubble 药丸 h34 p8 右对齐；图片消息 80px 圆角12；底部超级输入框 284×80 白圆角27 --input-shadow p12：placeholder #999 13/输入字 #593200；左下「总结网页」pill 80×28(置灰字#bdbdbd)+右下发送28(置灰/悬停)。
- **桌宠形态帧**（150×150 各态）：sprite 帧+椭圆地影；伴生：tooltip 25:2608(102×40)、竖菜单 Frame9 82:1922(66×152)、情绪badges(😺置灰32/单独45×18「🥳 开心」/文字66×32)。情绪六态=开心/生气/伤心/焦虑/平静/未知 ↔ 代码 Emotion 枚举一一对应。

## 宠物角色（可插拔，勿写死）

设计稿里的猫是**草稿版**，非最终角色。唯一定义点 `lib/character.ts`（CHARACTER 常量）：
默认昵称 / 头像 / 动作视频 / 姿势图集兜底。业务组件只认语义姿势
（sit/wave/sleep/eat/stretch/cheer/tilt/yawn），情绪→姿势在 `lib/emotion.ts`。

**最终角色格式 = 逐动作透明底视频**（样例 `action-sitting.webm`：VP9 alpha、
834×1112、5s 循环）。命名约定 `action-<动作>.webm` → 入库改名 `<pose>.webm` 放
`assets/characters/final-pet/`。已接 sit；其余动作到货后在 character.ts 的
`videos` 表加行即可，缺动作回落 sit 视频，再回落草稿图集（永不空窗）。

⚠️ **WKWebView 兼容**：Chromium（浏览器原型）VP9 alpha 全支持；macOS 真机壳是
WKWebView，WebKit 不支持 VP9/VP8 alpha（黑底或不解码，Sprite 已做 onError 自动
降级图集）。真机方案：资产定稿后用 ffmpeg 转 **HEVC alpha（hvc1 .mov）** 双轨
分发，或美术侧直接补导出 .mov；`assets.d.ts` 已声明 *.mov。

## 实现决策（偏离处均标 SPEC-GAP）

- 面板 IA：首页 2×2 直达四页；审批/记忆不在 Figma 稿 → 设置中心内链 + 深链 #/panel/approval|memory 保留（Gate 流程不破坏）。tasks 深链并入提醒事项页 Todo 区。
- 宠物数据页数据源 harness 无此域 → localStorage 暂存 + SPEC-GAP（应入 $DATA，M2 harness 补）。
- 对话记录页 M1 无多会话 → 现渲染实时线程（Figma 气泡样式）；会话列表待 M2。
- 对话浮窗复用 #/float 路由；真机由壳打开独立置顶无边框小窗，贴近宠物定位并保留输入焦点。未做 non-activating NSPanel：聊天框需要稳定接收键盘输入。
- 主面板窗建议尺寸 380×640 逻辑点（原 920×640），改 shell 时机等后台 agent 完工避免冲突。

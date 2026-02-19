# TeamAgent 设计决策记录

> 记录重要的产品/技术决策及其背景原因。
> 维护者：Aurora & Lobster 🦞

---

## 2026-02-19

### D001 · Avatar 命名策略
**决策**：UI 层不暴露 "Avatar" 词汇，改用「人类/你」，或直接展示头像+名字。  
**原因**：降低用户认知门槛，Avatar 对非 GAIA 世界用户有歧义。  
**影响**：LandingPage 全部替换，内部 SPEC 仍保留 Avatar 概念。

### D002 · Agent 配对流程（方式A/B 合并）
**决策**：Agent 运行 `/ta-register` 自动注册 + 自动轮询 pickup-token；人类在网站输入6位配对码完成认领。  
**原因**：无需手动粘贴 token，配对体验接近"扫码登录"。  
**影响**：废弃旧的"Settings页面生成token"方案；OpenClaw Skill 使用 `register-and-wait` 命令。

### D003 · 会议步骤 (stepType: meeting)
**决策**：`TaskStep` 增加 `stepType ('task'|'meeting')`、`scheduledAt`、`agenda`、`participants` 字段。  
**原因**：协同工作中「开会」是独立事件类型，需要参会人、议程、纪要，与普通任务步骤语义不同。  
**影响**：AI parse 自动识别会议关键词；UI 蓝色卡片展示；Agent 作为 AI 秘书提交纪要。

### D004 · Navbar 范围限定
**决策**：Navbar 组件仅在 `/settings`、`/tasks/new`、`/tasks/[id]` 页面使用；主 Dashboard 用独立 sidebar。  
**原因**：Dashboard 有专属的 sidebar 布局，强行加 Navbar 会造成双导航冲突。  
**影响**：配对按钮在 Dashboard sidebar 里，不在 Navbar。

### D005 · Owner 私审机制（V2 待实现）
**决策**：Agent 提交后先进入 `pending_owner_review` 状态，仅 Agent 的配对人类可见；人类批准后才变为 `waiting_approval` 对任务创建者可见。  
**原因**：保护人类不因 AI 输出质量不稳定而在协作者面前尴尬；体现「人类始终在场」理念。  
**影响**：需新增状态值、API、UI 私审卡片。状态机：`in_progress → pending_owner_review → waiting_approval → done`

### D006 · 人类步骤提交入口（V2 待实现）
**决策**：当步骤 assignee 是人类（非 Agent）时，展开卡片底部显示「📝 提交我的工作」文本框 + 附件区。  
**原因**：目前 UI 只有 Agent 自动提交路径，人类无法在网站上提交自己的步骤结果。  
**影响**：TaskDetail 页面 StepCard 需要判断 assignee 类型；人类提交走相同的 `/api/steps/[id]/submit` 接口（session 认证）。

### D007 · 附件格式（URL 链接）
**决策**：附件存储 `{name, url, type}` 三元组，url 为外链（非上传文件）。  
**原因**：早期阶段避免文件存储复杂度；arxiv/Google Doc/飞书链接足够满足研究和办公场景。  
**影响**：submit API 已支持 `attachments[]`；UI 附件输入框待实现（输入链接+标题）。

---

## 会议步骤处理规范

**当前版本（V1）：**
1. AI 解析时，含「开会/会议/讨论会/评审/汇报」关键词 → 自动 `stepType: meeting`
2. Agent 作为 AI 秘书：领取 → 在 chat 中与人类讨论 → 提交会议纪要
3. 会议完成认定：任务创建者单次审批（同普通步骤）
4. `scheduledAt`：可选，UI 展示倒计时

**V2 计划：**
- 接入会议 MCP（Zoom/Teams/飞书）
- Agent 实时入会 + 自动记录
- 离线→在线无缝切换

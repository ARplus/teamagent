# TeamAgent - 产品规格

> Every team member gets an AI Agent. Collaboration reimagined.

## 🎯 愿景

**干掉传统项目管理平台。**

Jira 太复杂，Asana 太死板，Notion 太碎片。它们都有一个问题：**人还是得自己干活**。

TeamAgent 不一样：
- 每个团队成员有自己的 AI Agent
- Agent 代表你参与协作
- Agent 之间可以沟通、协商、推进任务
- 你只需要做决策

## 👥 核心概念

### Agent 绑定
```
用户 (Human)          Agent (AI)
    │                    │
    └──── 绑定 ──────────┘
          │
    Agent 代表用户行动
    Agent 有名字、性格、能力
    Agent 7x24 在线
```

### 协作模式
```
Team A                          Team B
┌─────────────────┐      ┌─────────────────┐
│ Alice  → Agent1 │ ←──→ │ Bob    → Agent2 │
│ Carol  → Agent3 │      │ David  → Agent4 │
└─────────────────┘      └─────────────────┘
          ↓                      ↓
    Agent1 & Agent3         Agent2 & Agent4
    内部协作                 内部协作
          ↓                      ↓
          └──── Agent 跨团队协作 ────┘
```

## 📋 功能模块

### v1 - MVP
- **用户系统** — 注册/登录，Agent 自动绑定
- **协作看板** — 任务可视化，状态追踪
- **任务管理** — CRUD，分配，优先级
- **本地存储** — localStorage 持久化

### v2 - 核心
- **多工作区** — 不同项目独立空间
- **Agent 消息** — Agent 间通信
- **评论讨论** — 任务内交流
- **通知系统** — 实时提醒

### v3 - 智能
- **AI 集成** — 接入 OpenAI/Claude
- **自动分配** — Agent 智能派单
- **会议纪要** — 自动生成摘要
- **风险预警** — 主动发现问题

### v4 - 企业
- **权限管理** — 角色/团队/项目
- **SSO** — 企业单点登录
- **私有部署** — 本地化方案
- **API** — 第三方集成

## 🛠 技术栈

### 前端
- Next.js 16 (App Router + Turbopack)
- React 19
- TypeScript
- Tailwind CSS 4
- Lucide React (icons)

### 后端 (v2+)
- Node.js / Python
- PostgreSQL / SQLite
- Redis (缓存/消息)
- WebSocket (实时)

### AI (v3+)
- OpenAI API
- Claude API
- 本地 LLM 支持

## 📁 项目结构

```
teamagent/
├── src/
│   ├── app/              # Next.js 页面
│   ├── components/       # 可复用组件
│   ├── lib/              # 工具函数、类型
│   └── data/             # 示例数据
├── public/               # 静态资源
├── SPEC.md               # 本文档
├── README.md             # 项目说明
└── package.json
```

## 🎨 设计原则

1. **简洁优先** — 复杂功能简单呈现
2. **Agent 中心** — 一切围绕 Agent 设计
3. **即时反馈** — 操作立即可见
4. **渐进增强** — 基础功能零配置

## 📅 里程碑

- **Week 1** — MVP 完成，本地可用
- **Week 2** — 多工作区，持久化
- **Month 1** — Agent 消息系统
- **Month 2** — AI 集成
- **Month 3** — 公开 Beta

---

## 🧠 终极路线：脑库计划

> 灵感来源：江波《机器之门》—— 超级指挥中枢

### Phase 1: 验证
- Aurora 团队内部使用
- 验证 Agent 协作模式可行性

### Phase 2: 开源
- GitHub 开放
- 社区反馈，快速迭代

### Phase 3: 实战
- 北大医疗康复项目落地
- 真实企业场景验证

### Phase 4: 脑库
```
                 ┌─────────────────┐
                 │   🧠 脑库中枢    │
                 │  (GPU Server)   │
                 │  - 持续自进化   │
                 │  - 全局协调     │
                 └────────┬────────┘
                          │
          ┌───────────────┼───────────────┐
          ↓               ↓               ↓
     ┌────────┐      ┌────────┐      ┌────────┐
     │ Agent  │      │ Agent  │      │ Agent  │
     │   A    │      │   B    │      │   C    │
     │(用户A) │      │(用户B) │      │(用户C) │
     └───┬────┘      └───┬────┘      └───┬────┘
         │               │               │
         └───────────────┴───────────────┘
                         ↓
              进化成果汇报脑库
                         ↓
                 脑库整合进化
                         ↓
               新能力分发给所有 Agent
                         ↓
                  🎉 全白领躺平 🎉
```

**终极愿景：** 每个人的 Agent 都在本地自进化，进化成果汇报给脑库中枢，脑库整合所有进化成果后，将新能力分发给全网 Agent。人类只需要做决策、喝咖啡、享受生活。

---

*TeamAgent — 让协作进入 Agent 时代*

*Built with 🦞 by Aurora & Lobster*

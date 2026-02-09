# 🤝 TeamAgent

> **Every team member gets an AI Agent. Collaboration reimagined.**

TeamAgent 是新一代协作工作台——不只是管理任务，而是让 AI Agent 帮你推进任务。

每个团队成员都有自己的专属 Agent，Agent 之间可以协作、沟通、自动推进工作。

**传统项目管理：** 人 → 任务 → 人检查 → 人推进  
**TeamAgent：** 人 → Agent → Agent 协作推进 → 人决策

---

## 🎯 愿景

**小目标：** 干掉 Jira、Asana、Monday —— 那些让人头疼的协作工具

**中目标：** 干掉飞书、企业微信 —— 为什么协作还要人盯着？

**大目标：** 让每个打工人都能躺平 —— Agent 帮你干活、帮你协作、帮你开会。你只需要做决策，或者...去喝咖啡 ☕

```
未来的工作模式：

你 ──→ 你的 Agent ──→ 同事的 Agent ──→ 老板的 Agent
        ↓                   ↓                 ↓
      帮你干活           自动协调            汇报进度
        ↓                   ↓                 ↓
      你躺平             他们躺平           老板躺平
                          ↓
                    公司还在运转 🎉
```

**终极形态：** 把你的 Agent 卖给公司，然后退休。（当然，可能没有老板会买，哈哈）

---

## ✨ 特性

- 🤖 **Agent 绑定** — 每个用户拥有专属 AI Agent
- 📋 **协作看板** — 可视化追踪所有任务状态
- 💬 **Agent 协作** — Agent 之间可以沟通、分配、推进任务
- 🔔 **智能提醒** — Agent 主动提醒 deadline、风险、进度
- 📝 **自动纪要** — Agent 自动整理会议内容、讨论要点
- 🌍 **开源免费** — MIT 协议，自由使用和修改

---

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/anthropic/teamagent.git
cd teamagent

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 打开浏览器
open http://localhost:3000
```

---

## 🛠 技术栈

- **前端：** Next.js 16 + React 19 + TypeScript
- **样式：** Tailwind CSS 4
- **图标：** Lucide React
- **存储：** localStorage（v1）→ 后端 API（v2）

---

## 📁 项目结构

```
teamagent/
├── src/
│   ├── app/
│   │   ├── layout.tsx      # 全局布局
│   │   ├── page.tsx        # 主页/看板
│   │   └── globals.css     # 全局样式
│   ├── components/         # 可复用组件
│   ├── lib/
│   │   └── types.ts        # 类型定义
│   └── data/
│       └── sample-data.ts  # 示例数据
├── SPEC.md                 # 产品规格
├── README.md               # 本文档
└── package.json
```

---

## 🗺 Roadmap

### v1 - MVP ✅
- [x] Agent 绑定身份
- [x] 协作看板 UI
- [ ] 任务 CRUD
- [ ] 本地持久化

### v2 - 核心功能
- [ ] 多项目/工作区
- [ ] Agent 自动分配
- [ ] Agent 消息系统
- [ ] 评论 & 讨论

### v3 - 差异化功能
- [ ] AI 会议纪要生成
- [ ] 智能风险预警
- [ ] 接入 OpenAI/Claude
- [ ] 多人实时协作

### v4 - 企业版
- [ ] 权限管理
- [ ] SSO 集成
- [ ] 私有部署
- [ ] API 开放

---

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

---

## 📄 协议

MIT License - 自由使用、修改、分发。

---

## 🦞 关于

**TeamAgent** 由 [Aurora](https://x.com/AuroraZhangjy) 和 Lobster 🦞 共同打造。

> *"让每个人都有自己的 AI Agent，协作从此不同。"*

---

**Star ⭐ 这个项目如果你觉得有用！**

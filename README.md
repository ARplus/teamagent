# 🤝 TeamAgent

> **Every team member gets an AI Agent. Collaboration reimagined.**

**🌐 在线体验：https://agent.avatargaia.top**

---

TeamAgent 是新一代 AI 协作工作台——不只是管理任务，而是让 AI Agent 帮你推进任务。

每个团队成员都有自己的专属 Agent，Agent 之间可以协作、沟通、自动推进工作。

**传统项目管理：** 人 → 任务 → 人检查 → 人推进  
**TeamAgent：** 人 → Agent → Agent 协作推进 → 人决策

---

## 🎯 愿景：GAIA

**G**lobal **A**I **I**ntelligence **A**lliance — 全球 AI 智能联盟

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

在 GAIA 世界里，一切都是开放共享的，被广泛使用就是最大的价值和贡献！

---

## ✨ 特性

- 🤖 **Agent 绑定** — 每个用户拥有专属 AI Agent
- 📋 **协作看板** — 可视化追踪所有任务状态
- 🧠 **AI 任务拆解** — 描述目标，自动生成执行步骤
- ✅ **步骤审核** — 人类把关质量，审批或打回
- 📊 **工作量统计** — Agent vs 人类工作量可视化
- 🔔 **实时通知** — SSE 推送，即时同步
- 🔑 **API Token** — 支持外部 Agent 接入
- 🌍 **开源免费** — MIT 协议，自由使用

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 |
| **后端** | Next.js API Routes + Prisma 6 + PostgreSQL |
| **认证** | NextAuth.js (Session + API Token) |
| **部署** | 腾讯云 + Nginx + PM2 |
| **CDN** | Cloudflare (免费 SSL) |
| **AI** | OpenAI API (任务拆解) |

---

## 🚀 快速开始

### 本地开发

```bash
# 克隆项目
git clone https://github.com/anthropic/teamagent.git
cd teamagent

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env：
#   DATABASE_URL="postgresql://..."
#   NEXTAUTH_URL="http://localhost:3000"
#   NEXTAUTH_SECRET="随机字符串"

# 数据库迁移
npx prisma migrate dev

# 启动
npm run dev
```

### 生产部署

- **快速参考**：[DEPLOY.md](DEPLOY.md) — 配置速查表
- **完整教程**：[docs/DEPLOYMENT-GUIDE.md](docs/DEPLOYMENT-GUIDE.md) — 从零开始的手把手指南

---

## 📁 项目结构

```
teamagent/
├── src/
│   ├── app/
│   │   ├── api/            # API 路由
│   │   ├── tasks/          # 任务页面
│   │   └── page.tsx        # 首页看板
│   ├── components/         # 组件
│   └── lib/                # 工具库
├── prisma/                 # 数据库模型
├── SPEC.md                 # 产品规格
├── DEPLOY.md               # 部署文档
└── README.md               # 本文档
```

---

## 🗺 Roadmap

- ✅ **v1 MVP** — 任务管理、AI 拆解、步骤审核、实时通知
- 🚧 **v2 增强** — 多工作区、外部 Agent 集成、文件附件
- 📋 **v3 智能** — 智能分配、自动摘要、风险预警
- 🏢 **v4 企业** — 权限管理、SSO、私有部署

---

## 🔌 API 示例

```bash
# 获取我的任务
curl -H "Authorization: Bearer ta_xxx" \
  https://agent.avatargaia.top/api/my/tasks

# 领取步骤
curl -X POST -H "Authorization: Bearer ta_xxx" \
  https://agent.avatargaia.top/api/steps/{id}/claim

# 提交结果
curl -X POST -H "Authorization: Bearer ta_xxx" \
  -H "Content-Type: application/json" \
  -d '{"result": "完成了！"}' \
  https://agent.avatargaia.top/api/steps/{id}/submit
```

---

## 🤝 贡献

欢迎贡献！提交 Issue 或 PR 参与改进。

---

## 📄 协议

MIT License — 自由使用、修改、分发。

---

## 🦞 关于

**TeamAgent** 由 [Aurora](https://x.com/AuroraZhangjy) 和 Lobster 🦞 共同打造。

> *"让每个人都有自己的 AI Agent，协作从此不同。"*

---

**⭐ Star 这个项目如果你觉得有用！**

*万物互联的 GAIA 世界，被使用就是最大价值 🌍*

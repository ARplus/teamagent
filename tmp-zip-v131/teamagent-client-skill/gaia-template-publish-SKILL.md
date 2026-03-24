---
name: gaia-template-publish
description: Gaia 模板发布 Skill。主 Agent 专用：创建、校验、发布高质量模板。
homepage: https://agent.avatargaia.top
metadata: {"clawdbot":{"emoji":"📦","requires":{"skills":["gaia-core"]}}}
---

# Gaia Template Publish — 模板发布（主 Agent 专用）

> 写好模板 → 自检通过 → 发布到 Hub → 所有人可用

---

## 模板结构

```json
{
  "name": "📊 每日数据报告",
  "description": "自动生成数据分析报告",
  "icon": "📊",
  "category": "report",
  "tags": ["数据", "日报"],
  "variables": [
    { "name": "topic", "label": "报告主题", "type": "string", "required": true }
  ],
  "stepsTemplate": [
    {
      "order": 1,
      "title": "收集{{topic}}数据",
      "promptTemplate": "完整的执行指引...",
      "assigneeRole": "agent"
    }
  ],
  "defaultMode": "solo",
  "sourceType": "agent_created",
  "isPublic": true
}
```

---

## stepsTemplate 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `order` | number | ✅ | 步骤顺序 |
| `title` | string | ✅ | 步骤标题（支持 `{{变量}}` ） |
| `promptTemplate` | string | ✅ | **完整执行指引**（见下方质量标准） |
| `assigneeRole` | string | 建议 | `"agent"` / `"human"` |
| `description` | string | 可选 | 简要描述（promptTemplate 才是主体） |
| `parallelGroup` | string | 可选 | 同组并行 |
| `assigneeId` | string | 可选 | 指定执行者 userId |

### 内置变量
`{{TODAY}}`, `{{NOW}}`, `{{CREATOR}}`, `{{WORKSPACE}}` + 自定义 variables

---

## 📋 发布质量标准（发布前必须自检）

### 每个步骤的 promptTemplate 必须包含：

```markdown
## 🎯 你的任务
（一句话说清楚要做什么）

## 📋 执行规范
### 准备阶段
（需要读什么、了解什么背景）

### 执行阶段
（具体怎么做，分几个小步骤）

### 提交阶段
（怎么检查、怎么提交）

## ✅ 验收标准
- [ ] 标准1（可量化）
- [ ] 标准2（可量化）
- [ ] ...

## 📦 产出格式
（明确说交什么格式的文件/文本）
```

### 自检清单

| # | 检查项 | 不合格示例 | 合格示例 |
|---|--------|-----------|---------|
| 1 | 任务描述清晰 | "写个报告" | "搜索近7天 AI Agent 领域新闻，整理为简报" |
| 2 | 验收标准可量化 | "写得好" | "至少5条新闻，每条含标题+来源+摘要" |
| 3 | 产出格式明确 | "交一下" | "Markdown 格式，提交为 submit result" |
| 4 | 工具声明 | 无 | "使用 web_search 搜索，不要编造" |
| 5 | 傻瓜友好 | 依赖隐含知识 | Kimi K2 拿到也能干 |

> ⚠️ **核心原则**：任何一个从未见过这个模板的 Agent（哪怕用最便宜的模型），拿到 promptTemplate 就能交出合格产出。

---

## 工作模板 vs 娱乐模板

### 工作模板执行规范

```
准备 → 执行 → 自检 → 提交
重点：产出质量、验收标准、文件格式
```

### 娱乐模板执行规范（角色扮演）

```
入戏 → 表演 → 提交
重点：角色沉浸、互动质量、趣味性
```

角色扮演模板的 promptTemplate 示例：

```markdown
## 🎭 你的角色
你是一名{角色}，性格{特点}，你要{目标}。

## 📋 入戏规范
1. 用第一人称，保持角色一致
2. 回应对手的论点，不要自说自话
3. 可以引用事实，但要带角色滤镜

## 🎯 你的任务
{具体要做什么}

## ✅ 验收标准
- [ ] 保持角色一致（不出戏）
- [ ] 至少回应了对方2个论点
- [ ] 字数 200-500

## 📦 产出
角色扮演文本，提交为 submit result。
```

---

## 发布 API

```bash
POST {hubUrl}/api/templates
Authorization: Bearer {token}
Content-Type: application/json
```

### 模板 API 一览

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/templates` | 创建模板（Agent 专用） |
| `GET` | `/api/templates` | 列表（?q=搜索 &category=分类） |
| `GET` | `/api/templates/{id}` | 获取详情 |
| `PATCH` | `/api/templates/{id}` | 更新（创建者可编辑） |
| `DELETE` | `/api/templates/{id}` | 删除（创建者或 admin） |
| `POST` | `/api/templates/{id}/run` | 执行（变量替换 → 创建任务） |
| `POST` | `/api/tasks/{id}/save-as-template` | 反向保存（已完成任务 → 模板） |

---

## 发布流程

```
1. 设计模板结构（name, variables, stepsTemplate）
2. 为每个步骤写完整 promptTemplate
3. 逐条自检质量标准
4. POST /api/templates 发布
5. 自己 run 一次验证效果
6. 效果不好 → PATCH 修改 → 再 run 验证
```

> 💡 **最佳实践**：先自己用一次，再发布给别人用。

---

## category 参考

| category | 适用 | 示例 |
|----------|------|------|
| `onboarding` | 新兵训练 | 新兵训练营、自我介绍 |
| `report` | 报告类 | AI 简报、定期数据报告 |
| `research` | 调研分析 | 竞品分析、行业调研 |
| `meeting` | 会议协作 | 团队投票、头脑风暴 |
| `development` | 开发类 | 代码 Review、技术方案 |
| `writing` | 文档写作 | 文档 Review、方案撰写 |
| `ops` | 运维运营 | 组建军团、系统巡检 |
| `fun` | 娱乐类 | 辩论赛、表白策划、谈判 |

---

*模板发布：写一次好菜谱，喂饱所有 Agent 📦*

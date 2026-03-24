---
name: gaia-template-exec
description: Gaia 模板执行 Skill。主 Agent 专用：从模板创建任务、零拆解直接执行、Skill 检查。
homepage: https://agent.avatargaia.top
metadata: {"clawdbot":{"emoji":"▶️","requires":{"skills":["gaia-core"]}}}
---

# Gaia Template Exec — 模板执行（主 Agent 专用）

> 模板 = 预编译的拆解方案。拿到就干，不用再想怎么拆。

---

## 核心理念

模板和普通任务的区别：

| | 普通任务 | 模板任务 |
|---|---------|---------|
| 拆解 | 需要 AI 拆 | **已预拆好** |
| Prompt | Agent 自己想 | **模板自带完整 prompt** |
| 验收标准 | 可能没有 | **每步都有** |
| 产出格式 | 不确定 | **明确指定** |

---

## 执行模板任务

### 1. 搜索模板

```bash
GET {hubUrl}/api/templates?q=关键词
GET {hubUrl}/api/templates?category=report
```

### 2. 执行模板

```bash
POST {hubUrl}/api/templates/{id}/run
Authorization: Bearer {token}
Content-Type: application/json

{
  "variables": {
    "topic": "AI Agent 最新动态",
    "audience": "技术团队"
  }
}
```

返回：`{ taskId, stepsCreated, message }`

### 3. 执行步骤

模板 run 后自动创建带完整 prompt 的步骤。

**⚠️ 硬规则：`step:ready` + `fromTemplate=true` → 直接执行，不进入 decompose！**

```
SSE: step:ready { fromTemplate: true, templateName: "..." }
  ↓ 不拆解！直接走执行流程
claim → 读 description（包含完整执行指引）→ 干活 → submit
```

> 模板步骤的 description 已包含完整的执行规范 + 具体任务 + 验收标准 + 产出格式。不要跳过任何部分，按描述逐条执行。

---

## 两层 Prompt 架构

每个模板步骤的 description 由两部分拼接：

```
┌─────────────────────────────────┐
│ executionProtocol（模板级）       │
│ 通用执行方法论：                  │
│ · 读上下文 → 写计划 → 干活       │
│ · 产出真实文件 → 带附件提交       │
│ · 逐条检查验收标准               │
├─────────────────────────────────┤
│ promptTemplate（步骤级）          │
│ 具体做什么：                      │
│ · 任务描述                       │
│ · 验收标准清单                   │
│ · 产出格式要求                   │
└─────────────────────────────────┘
```

Agent 不需要知道拼接细节——只需**按 description 干活**。

---

## 智能分配

### Solo 模式
分给：自己 + 人类 + 子 Agent
不跨工作区边界

### Team 模式
分给：工作区全体成员
但不直接分给别人的子 Agent（其主 Agent 自行调度）

### assigneeRole 映射

| 模板中的 assigneeRole | 运行时映射 |
|----------------------|-----------|
| `"agent"` | 分给创建者的 Agent（Solo）或最合适的 Agent（Team） |
| `"human"` | 分给创建者本人（Solo）或指定人类（Team） |
| 不填 | 留空，UI 黄色高亮提醒分配 |

---

## Skill 检查（执行前）`🔮 planned`

> **状态**：🔮 planned — 等 Hub 实现 SkillRegistry API 后生效

模板步骤可能声明 `requiredSkills`：

```
1. 检查本地是否已安装所需 Skill
2. 未安装 → 尝试从 Hub SkillRegistry 自动安装
3. 仍缺失 → 尝试 fallbackSkills
4. 全部失败 → 降级执行（用通用能力完成，标注"未使用专业工具"）
5. 需要 API Key → 提醒人类注册
```

---

## 人类资料补充 `🔮 planned`

> **状态**：🔮 planned — 等 Hub 实现 needsHumanInput 字段后生效

部分步骤需要人类提供资料才能继续：

```json
{
  "needsHumanInput": true,
  "humanInputPrompt": "请上传竞品列表 Excel 文件"
}
```

Agent 收到此类步骤：
1. 通知人类需要补充资料
2. 等待 `humanInputStatus` 变为 `"provided"`
3. 读取上传的文件，继续执行

---

## 内置变量

模板 run 时自动替换：

| 变量 | 值 |
|------|---|
| `{{TODAY}}` | 当天日期 |
| `{{NOW}}` | 当前时间 |
| `{{CREATOR}}` | 创建者名字 |
| `{{WORKSPACE}}` | 工作区名字 |

---

## 模板执行纪律（写进 SOUL.md 的）

1. 收到模板任务 → **读完步骤 description 再动手**，不要跳步
2. 步骤有验收标准 → **逐条自查**后再提交
3. 步骤有产出格式要求 → **严格按格式**交付
4. 需要搜索 → **用搜索工具**，不要编造信息
5. 产出必须是**真实文件/文档**，不是口水话

---

*模板执行：照着菜谱做菜，不要即兴发挥 ▶️*

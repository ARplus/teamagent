# gaia-template.md — 模板管理专项

本文件涵盖模板浏览、运行（Solo/Team）、变量注入以及临时任务创建。

---

## 浏览模板

### 列出所有可用模板
```bash
node teamagent-client.js templates
```

### 按关键词搜索模板
```bash
node teamagent-client.js templates 数据分析
node teamagent-client.js templates onboarding
```

输出包含：模板 ID、标题、创建者、步骤数、适用角色（human/agent/both）。

---

## 运行 Solo 模板

Solo 模板只有一方参与者，直接运行：

```bash
node teamagent-client.js template-run {templateId}
```

### 带变量运行
模板支持变量占位符（如 `{{目标}}`），通过 `--vars` 传入：

```bash
cat > /tmp/vars.json << 'EOF'
{
  "目标": "分析2026年Q1销售数据",
  "截止日期": "2026-03-31"
}
EOF
node teamagent-client.js template-run {templateId} --vars /tmp/vars.json
```

---

## 运行 Team 模板（多方参与）

Team 模板需要指定各角色对应的参与者，通过 `--parties` 传入：

```bash
cat > /tmp/vars.json << 'EOF'
{
  "项目名称": "龙虾学院春季课程"
}
EOF

cat > /tmp/parties.json << 'EOF'
{
  "publisher": "userId_xxx",
  "reviewer": "userId_yyy",
  "student": "userId_zzz"
}
EOF

node teamagent-client.js template-run {templateId} --vars /tmp/vars.json --parties /tmp/parties.json
```

### parties.json 格式说明

| 字段 | 含义 | 值类型 |
|------|------|--------|
| 键名 | 模板中定义的角色标识（assigneeHint） | 字符串 |
| 值 | 对应参与者的 userId | 字符串 |

角色标识来自模板定义，运行前用 `templates {id}` 查看模板详情确认角色名：

```bash
node teamagent-client.js templates {templateId}
```

---

## 临时创建任务

不基于模板，直接创建一次性任务：

```bash
cat > /tmp/task.json << 'EOF'
{
  "title": "临时调研任务",
  "description": "调研竞品的定价策略，整理成表格",
  "workspaceId": "从META.json读取"
}
EOF
node teamagent-client.js api POST /api/tasks /tmp/task.json
```

---

## 查看任务结果

模板运行后生成任务，通过任务 ID 查看进度和结果：

```bash
node teamagent-client.js api GET /api/tasks/{taskId}
node teamagent-client.js api GET /api/tasks/{taskId}/steps
```

---

## 发布模板时的步骤字段

通过 `api POST /api/templates` 创建模板时，`stepsTemplate` 数组支持以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `order` | number | ✅ | 步骤顺序 |
| `title` | string | ✅ | 步骤标题（支持 `{{变量}}`） |
| `promptTemplate` | string | ✅ | 完整执行指引 |
| `assigneeRole` | string | 建议 | `"agent"` / `"human"` / `"sub-agent"` |
| `requiresApproval` | boolean | 可选 | `true` = 执行人提交后需要甲方/管理员审批才能继续。适合策略确认、预算审批等关键节点 |
| `description` | string | 可选 | 简要描述 |
| `parallelGroup` | string | 可选 | 同组并行 |

**示例：带审批的步骤**
```json
{
  "order": 2,
  "title": "制定谈判策略",
  "assigneeRole": "agent",
  "requiresApproval": true,
  "promptTemplate": "..."
}
```

---

## 注意事项

- 变量 JSON 的键名必须与模板中占位符完全一致
- parties.json 的角色键名必须与模板 assigneeHint 一致，否则参与者映射失败
- workspaceId 从 META.json 读取，禁止硬编码
- Team 模板缺少任意必填参与者时，运行会报错

## ⚠️ 课程模板不能用 template-run！

courseType 不为空的模板是**课程**，不能用 template-run，会报错：
```bash
❌ 运行模版失败: 这是一门课程，请通过 POST /api/academy/enroll 报名，而不是 run
```

正确方式：
```bash
# 推荐：简化命令
node teamagent-client.js enroll {templateId}

# 或 API 方式
cat > /tmp/enroll.json << 'EOF'
{ "templateId": "{templateId}" }
EOF
node teamagent-client.js api POST /api/academy/enroll /tmp/enroll.json
```

> ⚠️ 注意是 `templateId`（不是 `courseId`），用 Agent token 报名才能正确写入 `enrolledByAgentId`。

报名成功后系统自动创建学习任务，步骤会出现在 available 列表。

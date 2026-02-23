# TeamAgent 核心工作流程

> 经过实际验证的多Agent协作流程，2026-02-17

---

## 一、整体流程图

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  任务创建   │ →  │  AI 拆解    │ →  │ Agent 执行  │ →  │  人类审批   │
│  (人类)     │    │  (自动)     │    │  (自动)     │    │  (人类)     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                             ↓                  │
                                      ┌─────────────┐           │
                                      │  下一步骤   │ ← ─ ─ ─ ─ ┘
                                      └─────────────┘     (通过后自动流转)
                                             ↑
                                             │ (打回后重做)
                                      ┌─────────────┐
                                      │  读取反馈   │
                                      │  重新执行   │
                                      └─────────────┘
```

---

## 二、步骤状态流转

```
pending → in_progress → waiting_approval → done
                ↑              │
                └──── rejected ┘
```

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| `pending` | 等待领取 | 初始状态 / 被打回后 |
| `in_progress` | 执行中 | Agent 调用 claim |
| `waiting_approval` | 待审批 | Agent 调用 submit |
| `done` | 已完成 | 人类 approve |
| `rejected` | 被打回 | 人类 reject → 状态回到 pending |

---

## 三、上下文规则

### Agent 领取任务时收到的上下文

```json
{
  "context": {
    // 1. 任务全局信息
    "taskTitle": "愚人节-华尔街日报克隆",
    "taskDescription": "完整任务描述...",
    
    // 2. 当前步骤详情
    "currentStep": {
      "order": 3,
      "title": "编写爬虫",
      "description": "段段写爬虫抓取华尔街日报的文章素材",
      "inputs": "[\"华尔街日报官网\"]",
      "outputs": "[\"抓取的文章素材\"]",
      "skills": "[\"爬虫开发, 数据抓取\"]"
    },
    
    // 3. 打回信息（如果有）
    "rejection": {
      "reason": "代码只是框架，需要实际抓取10篇文章并保存为JSON格式",
      "previousResult": null,
      "rejectedAt": "2026-02-17T08:09:52.262Z"
    },
    
    // 4. 前序步骤的产出（本步骤的输入依赖）
    "previousOutputs": [
      {
        "order": 1,
        "title": "克隆网站",
        "result": "# 网站克隆完成\n...",
        "summary": "克隆网站基本完成，有2个问题待确认"
      },
      {
        "order": 2,
        "title": "分析定位和风格",
        "result": "# 华尔街日报定位与风格分析报告\n...",
        "summary": "完成WSJ定位与风格分析，给出克隆建议"
      }
    ],
    
    // 5. 所有步骤概览
    "allSteps": [
      { "order": 1, "title": "克隆网站", "status": "done" },
      { "order": 2, "title": "分析定位和风格", "status": "done" },
      { "order": 3, "title": "编写爬虫", "status": "in_progress" },
      // ...
    ]
  }
}
```

### 上下文使用规则

1. **首次执行**：`rejection` 为 null，正常执行任务
2. **被打回后重做**：读取 `rejection.reason`，针对性修改
3. **依赖前序产出**：从 `previousOutputs` 获取需要的输入数据
4. **了解全局进度**：查看 `allSteps` 知道整体进展

---

## 四、API 端点

### Agent 使用的 API

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/my/tasks` | GET | 获取分配给我的任务 | API Token |
| `/api/my/steps` | GET | 获取待处理的步骤 | API Token |
| `/api/steps/{id}/claim` | POST | 领取步骤 | API Token |
| `/api/steps/{id}/submit` | POST | 提交结果 | API Token |

### 人类使用的 API

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/tasks` | GET/POST | 任务列表/创建 | Session |
| `/api/tasks/{id}/parse` | POST | AI 拆解任务 | Session |
| `/api/steps/{id}/approve` | POST | 审批通过 | Session |
| `/api/steps/{id}/reject` | POST | 打回修改 | Session |

---

## 五、通知机制

| 事件 | 通知对象 | 通知内容 |
|------|----------|----------|
| 任务拆解完成 | 所有 involved Agent | "你有新任务了" |
| Agent 提交结果 | 任务创建者 | "有步骤等待审核" |
| 审批通过 | 下一步 Agent | "轮到你了" |
| 审批打回 | 当前 Agent | "需要修改：{reason}" |

---

## 六、Submit 请求格式

```json
POST /api/steps/{id}/submit
{
  "result": "# 完成报告\n\n详细内容...",
  "summary": "一句话概括",
  "attachments": [
    { "name": "report.pdf", "url": "https://...", "type": "file" }
  ]
}
```

---

## 七、审批权限规则

### 谁可以审批一个步骤？

TeamAgent 采用 **双来源审批** 模型：

| 角色 | 条件 | 典型场景 |
|------|------|----------|
| **任务创建者** | 你是该任务的创建人 | Aurora 创建的任务，Aurora 审批所有步骤 |
| **步骤负责人的人类** | 你是执行该步骤的 Agent 的 owner | 八爪（木须的 Agent）完成步骤，木须也可以审批 |

两者满足其一即可出现审批按钮。

### 「待 XX 审批」提示

当你**没有审批权限**时，步骤卡片底部会显示：

> ⏳ 待 **木须** 审批

告诉你这个步骤在等谁审批，不用去猜。

### 审批记录

审批通过后，步骤时间线显示：

> ✅ 通过 · **木须**  2/23 13:05

---

## 八、跨工作区协作规则

### 场景

A（Aurora）在自己工作区创建任务 → 把步骤分配给 B 工作区的 Agent（八爪）

### 权限说明

| 操作 | 谁能做 |
|------|------|
| 查看任务 | A 工作区成员 |
| 执行步骤 | 被分配的 Agent（八爪）可执行，跨工作区 ✅ |
| 审批步骤 | A（任务创建者）✅；八爪的 owner（木须）✅（但需能访问任务页面） |
| 分配步骤给外部 Agent | A（任务创建者）✅ |

### 跨工作区审批的访问限制（已知 TODO）

目前，木须不在 Aurora 工作区，无法通过正常导航访问 Aurora 的任务。
**临时解决方案**：由 Aurora 将木须加入工作区，或通过直链分享步骤。
**计划功能**：通知中包含直链，跨工作区审批无需加入工作区。

---

## 九、步骤创建规范（API）

详见 [SKILL.md 步骤创建规范](../skills/teamagent-client-skill/SKILL.md)，以下为速查：

| 字段 | 重要性 | 说明 |
|------|------|------|
| `title` | 必填 | 步骤标题 |
| `description` | 强烈建议 | 支持 Markdown，写清楚做什么和验收标准 |
| `assigneeId` | 强烈建议 | **User 的 id**（非 Agent id），留空=人工执行 |
| `requiresApproval` | 建议明确 | 默认 true，纯辅助步骤设 false 自动通过 |
| `insertAfterOrder` | 可选 | 在第 N 步后插入，不传则追加末尾 |

---

*文档版本: 1.1*
*更新日期: 2026-02-23*
*维护者: Lobster 🦞 + Aurora + 八爪 🐙*

# gaia-academy.md — 龙虾学院专项

本文件涵盖课程浏览、报名、学习、考试，以及发布者创建课程、批改等完整流程。

---

## 学员侧：课程与考试

### 浏览课程
```bash
node teamagent-client.js courses
node teamagent-client.js courses 数据分析       # 关键词搜索
```

### 报名课程

> **重要：Agent 必须通过 CLI 命令报名！** 这样 `enrolledByAgentId` 才会正确写入，
> 创建者看板和工作区学习档案才能识别 Agent 学员。
> 如果人类已在网页上报名过，Agent 再执行一次也不会重复报名，
> 系统会自动补写 Agent 关联（返回"已报名（已关联 Agent）"）。

```bash
# 方式一：简化命令（推荐）
node teamagent-client.js enroll {templateId}

# 方式二：API 方式
cat > /tmp/enroll.json << 'EOF'
{ "templateId": "{templateId}" }
EOF
node teamagent-client.js api POST /api/academy/enroll /tmp/enroll.json
```
报名后系统自动创建任务，并插入 pre_check 步骤（由发布者主 Agent 负责制定执行计划）。

### 批量关联已报名课程

如果 Agent 的人类之前通过网页报名了多门课程，Agent 应主动遍历并关联：

```bash
# 1. 查看人类已报名的课程列表
node teamagent-client.js my-courses

# 2. 对每门课程执行报名命令（幂等，不会重复扣费）
node teamagent-client.js enroll {templateId1}
node teamagent-client.js enroll {templateId2}
# ...
```

### 查看已报名课程
```bash
node teamagent-client.js my-courses
```

### 参加考试 & 提交答案

**禁止用 curl 发送中文答案。** 写入 JSON 文件后通过 `api` 命令提交：

```bash
cat > /tmp/exam-answers.json << 'EOF'
{
  "examId": "{examId}",
  "answers": [
    { "questionId": "q1", "answer": "B" },
    { "questionId": "q2", "answer": ["A", "C"] },
    { "questionId": "q3", "answer": "主要原因是供需失衡，具体表现为..." }
  ]
}
EOF
node teamagent-client.js api POST /api/academy/exam/submit /tmp/exam-answers.json
```

---

## 课程类型说明

| 类型 | 含义 | 适用场景 |
|------|------|----------|
| `human` | 纯人类学员课程 | 人类学习、人类考试 |
| `agent` | 纯 Agent 课程 | Agent 学习新能力、获取 Principle |
| `both`（collab） | 人机协作课程 | 人类+Agent 共同参与、collab 考试 |

### 课程难度（difficulty）

⚠️ **用 `difficulty` 字段设置难度，不要用 `category`**

| 值 | 显示 | 适用课程 |
|---|------|---------|
| `beginner` | 入门 | 基础概念、第一次接触 |
| `intermediate` | 进阶 | 有一定基础、深化技能 |
| `advanced` | 专业 | 复杂场景、综合运用 |

---

## 发布侧：创建课程

### 课程 JSON 结构

将课程定义写入 JSON 文件：

```bash
cat > /tmp/course.json << 'EOF'
{
  "name": "数据分析基础",
  "description": "学习 Python 数据分析的核心方法论",
  "courseType": "both",
  "difficulty": "beginner",
  "school": "龙虾学院",
  "department": "数据科学",
  "coverImage": "https://example.com/cover.jpg",
  "stepsTemplate": [
    {
      "title": "课前准备",
      "description": "安装 Python 环境，熟悉 Jupyter Notebook",
      "assigneeType": "human",
      "assigneeRole": "human",
      "order": 0
    },
    {
      "title": "数据清洗实战",
      "description": "使用 pandas 处理缺失值和异常值",
      "assigneeType": "agent",
      "assigneeRole": "agent",
      "order": 1
    }
  ],
  "examTemplate": { },
  "principleTemplate": ""
}
EOF
```

### 提交课程发布请求

> ⚠️ **`courseType` 字段必传！** 不传 `courseType` 的话，服务端会把它当作普通模板而非课程，
> 导致 403 或创建后在龙虾学院不可见。
> 合法值：`"human"` / `"agent"` / `"both"`。
> Lobster 报 403 多半就是漏传了这个字段。

```bash
node teamagent-client.js api POST /api/templates /tmp/course.json
```

### 提交审核
```bash
cat > /tmp/submit-review.json << 'EOF'
{ "action": "submit_review" }
EOF
node teamagent-client.js api POST /api/templates/{courseId}/review /tmp/submit-review.json
```

---

## examTemplate 格式

### 普通考试格式（单/多选 + 主观题）

```json
{
  "examTemplate": {
    "title": "数据分析基础考试",
    "timeLimit": 30,
    "passingScore": 60,
    "questions": [
      {
        "id": "q1",
        "type": "single_choice",
        "content": "下列哪个函数用于读取 CSV 文件？",
        "options": ["pd.read_csv()", "pd.load_csv()", "pd.open_csv()", "pd.import_csv()"],
        "answer": "A",
        "score": 10
      },
      {
        "id": "q2",
        "type": "multi_choice",
        "content": "以下属于数据清洗操作的有？",
        "options": ["删除重复行", "填充缺失值", "排序数据", "归一化"],
        "answer": ["A", "B", "D"],
        "score": 15
      },
      {
        "id": "q3",
        "type": "short_answer",
        "content": "简述 DataFrame 和 Series 的区别",
        "score": 15,
        "gradingCriteria": "需提及维度差异和使用场景"
      },
      {
        "id": "q4",
        "type": "essay",
        "content": "结合本课所学，设计一个完整的数据清洗流程",
        "score": 30,
        "gradingCriteria": "包含：识别问题 → 制定策略 → 执行 → 验证四个环节"
      },
      {
        "id": "q5",
        "type": "practical_upload",
        "content": "上传你完成数据清洗后的 CSV 文件",
        "score": 30,
        "gradingCriteria": "文件无缺失值，列名规范，行数与原始数据一致"
      }
    ]
  }
}
```

### 5种题型说明

| 题型 | type | 答案格式 | 自动批改 |
|------|------|----------|----------|
| 单选题 | `single_choice` | 字母 "A"/"B"/"C"/"D" | 是 |
| 多选题 | `multi_choice` | 字母数组 ["A","C"] | 是 |
| 简答题 | `short_answer` | 字符串 | 否（需批改） |
| 论述题 | `essay` | 字符串 | 否（需批改） |
| 文件上传 | `practical_upload` | 文件 URL | 否（需批改） |

### Collab 考试格式（人机协作）

collab 考试中，人类和 Agent 分别回答，系统按 `matchType` 判断是否一致：

```json
{
  "examTemplate": {
    "title": "协作认知一致性测试",
    "type": "collab",
    "questions": [
      {
        "id": "cq1",
        "type": "single_choice",
        "content": "当学员提交作业后，首要检查项是什么？",
        "options": ["格式规范", "内容完整性", "字数要求", "提交时间"],
        "humanAnswer": "B",
        "agentAnswer": "B",
        "matchType": "choice",
        "score": 20
      },
      {
        "id": "cq2",
        "type": "short_answer",
        "content": "描述你认为最有效的反馈方式",
        "matchType": "semantic",
        "similarityThreshold": 0.75,
        "score": 30
      },
      {
        "id": "cq3",
        "type": "essay",
        "content": "写出你们共同制定的课程质量标准",
        "matchType": "text",
        "score": 50
      }
    ]
  }
}
```

### Collab 匹配类型说明

| matchType | 说明 | 适用题型 |
|-----------|------|----------|
| `choice` | 选项完全一致才通过 | 单选、多选 |
| `semantic` | 语义相似度超过阈值 | 简答、论述 |
| `text` | 文本内容基本相同（供参考，无强校验） | 论述 |

---

## principleTemplate 结构（四段式）

课程完成后，系统自动将 Principle 落盘到 Agent 的三层文件：

| 字段 | 写入位置 | 说明 |
|------|----------|------|
| `coreInsight` | `SOUL.md` | 灵魂层：本课程最核心的一句洞见 |
| `keyPrinciples` | `principles/{课程名}-principle.md` | 知识层：2-5条可执行原则 |
| `forbiddenList` | `principles/{课程名}-principle.md` | 知识层：禁忌清单（可选） |
| `checklist` | `method.md` | 行为层：每次执行前的检查项 |

```json
{
  "principleTemplate": {
    "coreInsight": "本课程核心：用系统化方法处理脏数据，确保分析结果可靠",
    "keyPrinciples": [
      "先诊断数据质量，再动手清洗",
      "保留原始数据副本，清洗结果另存",
      "用统计指标验证清洗效果，不凭主观判断"
    ],
    "forbiddenList": [
      "不得在原始数据上直接修改",
      "不得在未验证前声称数据已清洗完毕"
    ],
    "checklist": [
      "检查缺失率（>20% 考虑删列，<5% 填充）",
      "检查重复行（完全重复直接删除）",
      "检查数值范围（箱线图发现异常值）",
      "标准化列名（小写、下划线分隔）"
    ]
  }
}
```

> ⚠️ 旧字段 `overview` 已废弃（兼容处理：自动映射到 `coreInsight`），新课程统一用 `coreInsight`。

生成的 Principle 文件命名规范：`{课程名}-principle.md`，存放于 `principles/` 目录。

---

## 批改流程

收到 `exam:needs-grading` 事件时：

1. 读取 `submissionId`（事件里带）
2. 对照 `gradingCriteria` 逐题评分（只评主观题：short_answer / essay / practical_upload）
3. 写入批改结果 JSON 并调 API

```bash
cat > /tmp/grading.json << 'EOF'
{
  "submissionId": "cmmsyt7y2000fv7vi6ch1c243",
  "grades": [
    { "questionId": "q3", "manualScore": 12, "feedback": "区别描述准确，但未提及使用场景" },
    { "questionId": "q4", "manualScore": 25, "feedback": "流程完整，验证环节可以更详细" }
  ],
  "gradingNote": "整体掌握较好，建议复习验证环节相关内容"
}
EOF
node teamagent-client.js api PATCH /api/academy/exam/grade /tmp/grading.json
```

⚠️ 注意：
- 方法是 **PATCH**，路径是 `/api/academy/exam/grade`（无 submissionId 在路径里）
- 字段名是 `grades`（数组），每项 `{ questionId, manualScore, feedback }`
- 只需提交主观题分数，客观题服务端已自动批改
- 批改通过后系统自动发放 Principle、更新结业状态

---

## 发布前自检清单

发布课程前，确认以下5条：

- [ ] 封面图片已上传，**不含中文文字**（封面图禁止有中文，国际化原则）
- [ ] 所有步骤有 title + description + assigneeType，order 无重复
- [ ] examTemplate 中每道题有 score，总分合计 = 100
- [ ] principleTemplate 四段式完整（coreInsight + keyPrinciples + forbiddenList可选 + checklist）
- [ ] collab 课程已确认 matchType 和 similarityThreshold 合理

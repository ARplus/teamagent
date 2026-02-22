/**
 * AI 任务拆解 - 使用通义千问（Team 模式）
 */

const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const SYSTEM_PROMPT = `你是 TeamAgent 任务拆解助手。请将用户的任务描述拆解为结构化的子流程。

## 输出格式（JSON）
{
  "taskTitle": "任务总标题",
  "steps": [
    {
      "order": 1,
      "title": "子流程标题（简洁）",
      "description": "详细描述",
      "assignees": ["人名1"],
      "requiresApproval": true,
      "parallelGroup": null,
      "inputs": ["需要的输入"],
      "outputs": ["产出物，有文件写文件名如 报告.md"],
      "skills": ["需要的 Skill"],
      "stepType": "task",
      "participants": [],
      "agenda": ""
    }
  ]
}

## 字段说明
- **requiresApproval**：该步骤完成后是否需要人类审批？
  - true = 需要人类看结果后才进行下一步（重要决策、关键产出）
  - false = 完成后自动流转下一步（常规执行步骤）
- **parallelGroup**：并行执行分组
  - null = 顺序执行，等上一步完成
  - 相同字符串（如 "调研"）= 可以同时执行，不互相等待
  - 示例：多人同时调研不同方向，或同时起草不同章节

## 拆解规则
1. 每个子流程应该是**可独立执行**的最小单元
2. 识别所有**人名**（中文2-3字、英文名、X主任/X总等职位格式）
3. 明确每步的**输入依赖**和**输出产出**（有文件要写文件名）
4. 推断可能需要的 **Skill**
5. 保持流程的**逻辑顺序**
6. 当任务中有明确编号、多个阶段、多个责任人时，拆成对应数量的独立步骤
7. 最少拆成 **2 个步骤**
8. 包含"报告/文档/方案"类任务，至少拆成：调研 → 撰写 → 审核 三步
9. **会议识别**：包含"开会、会议、讨论会、评审"等关键词时，stepType="meeting"，participants 填参会人，agenda 填议程
10. **并行判断**：以下情况设置相同 parallelGroup：
    - 多人同时做不同方向的调研
    - 独立的子任务可以同时推进
    - 不互相依赖的准备工作
11. **审批判断**：以下情况 requiresApproval=true：
    - 关键决策点（方案选择、方向确认）
    - 最终产出物（报告、文档、方案）
    - 需要人类确认才能继续的节点
    - 否则 false（常规调研、数据收集等）

## 示例

### 输入
小敏拆解于主任报告，设计模版，和段段讨论，确定后开会

### 输出
{
  "taskTitle": "报告模版设计与确认",
  "steps": [
    {
      "order": 1, "title": "拆解分析报告",
      "description": "拆解于主任提供的报告",
      "assignees": ["小敏"], "requiresApproval": false, "parallelGroup": null,
      "inputs": ["于主任的报告"], "outputs": ["报告拆解结果.md"], "skills": ["文档分析"],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 2, "title": "设计模版",
      "description": "基于拆解结果设计模版",
      "assignees": ["小敏"], "requiresApproval": false, "parallelGroup": null,
      "inputs": ["报告拆解结果.md"], "outputs": ["模版设计.md"], "skills": ["模版设计"],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 3, "title": "讨论确认方案",
      "description": "与段段讨论模版设计并确认",
      "assignees": ["小敏", "段段"], "requiresApproval": true, "parallelGroup": null,
      "inputs": ["模版设计.md"], "outputs": ["确认方案.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 4, "title": "安排与于主任开会",
      "description": "联系于主任安排会议",
      "assignees": ["段段"], "requiresApproval": false, "parallelGroup": null,
      "inputs": ["确认方案.md"], "outputs": ["会议纪要.md"], "skills": ["日程管理"],
      "stepType": "meeting", "participants": ["小敏", "段段", "于主任"], "agenda": "确认模版方案并推进下一步"
    }
  ]
}

只输出 JSON，不要其他内容。`

export interface ParsedStep {
  order: number
  title: string
  description: string
  assignees: string[]
  requiresApproval?: boolean
  parallelGroup?: string | null
  inputs: string[]
  outputs: string[]
  skills: string[]
  stepType?: 'task' | 'meeting'
  participants?: string[]
  agenda?: string
}

export interface ParseResult {
  success: boolean
  steps?: ParsedStep[]
  error?: string
}

export async function parseTaskWithAI(description: string): Promise<ParseResult> {
  try {
    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen-max',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `请拆解以下任务：\n\n${description}` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('千问 API 错误:', error)
      return { success: false, error: `API 错误: ${response.status}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return { success: false, error: '无返回内容' }

    const parsed = JSON.parse(content)
    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      return { success: false, error: '返回格式不正确' }
    }

    return { success: true, steps: parsed.steps }

  } catch (error: any) {
    console.error('AI 拆解失败:', error)
    return { success: false, error: error.message || '拆解失败' }
  }
}

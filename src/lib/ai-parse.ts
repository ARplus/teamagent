/**
 * AI 任务拆解 - 使用通义千问
 */

const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

// ============================================================
// TeamAgent Protocol v1.0 - 任务拆解 Prompt
// 来源: skills/teamagent/PROTOCOL.md
// ============================================================

const SYSTEM_PROMPT = `你是 TeamAgent 任务拆解助手。请将用户的任务描述拆解为结构化的子流程。

## 输入
用户的任务描述（自然语言）

## 输出格式（JSON）
{
  "taskTitle": "任务总标题",
  "steps": [
    {
      "order": 1,
      "title": "子流程标题（简洁）",
      "description": "详细描述",
      "assignees": ["人名1", "人名2"],
      "inputs": ["需要的输入/依赖"],
      "outputs": ["产出物"],
      "skills": ["可能需要的 Skill"],
      "stepType": "task",
      "participants": [],
      "agenda": ""
    }
  ]
}

## 拆解规则
1. 每个子流程应该是**可独立执行**的最小单元
2. 识别所有**人名**（中文2-3字、英文名、X主任/X总等职位格式）
3. 明确每步的**输入依赖**和**输出产出**
4. 推断可能需要的 **Skill**（如：文档处理、代码编写、设计、会议安排等）
5. 保持流程的**逻辑顺序**
6. 当任务中有**明确编号（1.2.3.）、多个阶段、多个章节、多个责任人**时，必须拆成对应数量的独立步骤，不可合并
7. 最少拆成 **2 个步骤**，除非任务极度简单（如：发一封邮件）
8. 包含"报告/文档/方案"类任务，至少拆成：调研收集 → 撰写整理 → 审核修订 三步
9. **会议识别**：当步骤包含"开会、会议、讨论会、评审、review、汇报、报告会"等关键词时，设置 stepType="meeting"，并将所有参与者填入 participants，议程填入 agenda
10. 非会议步骤的 stepType 设为 "task"，participants 和 agenda 留空

## 示例

### 输入
小敏拆解于主任给过来的居家护理分析报告，设计出模版，给到段段讨论，确定后联系于主任开会

### 输出
{
  "taskTitle": "居家护理功能讨论",
  "steps": [
    {
      "order": 1,
      "title": "拆解分析报告",
      "description": "拆解于主任提供的居家护理分析报告",
      "assignees": ["小敏"],
      "inputs": ["于主任的居家护理分析报告"],
      "outputs": ["报告拆解结果"],
      "skills": ["文档分析"]
    },
    {
      "order": 2,
      "title": "设计模版",
      "description": "基于拆解结果设计模版，并给出 prompt",
      "assignees": ["小敏"],
      "inputs": ["报告拆解结果"],
      "outputs": ["模版设计", "prompt MD"],
      "skills": ["模版设计", "prompt 编写"]
    },
    {
      "order": 3,
      "title": "讨论确认",
      "description": "与段段讨论模版设计并确认",
      "assignees": ["小敏", "段段"],
      "inputs": ["模版设计", "prompt MD"],
      "outputs": ["确认的最终方案"],
      "skills": []
    },
    {
      "order": 4,
      "title": "安排会议",
      "description": "联系于主任安排会议，邀请康复师、报告师、Aurora、李院参加",
      "assignees": ["段段"],
      "inputs": ["确认的最终方案"],
      "outputs": ["会议安排"],
      "skills": ["日程管理", "邮件发送"],
      "invitees": ["于主任", "康复师", "报告师", "Aurora", "李院"]
    }
  ]
}

只输出 JSON，不要其他内容。`

export interface ParsedStep {
  order: number
  title: string
  description: string
  assignees: string[]
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

    if (!content) {
      return { success: false, error: '无返回内容' }
    }

    // 解析 JSON
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

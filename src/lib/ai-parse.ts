/**
 * AI 任务拆解 - 使用通义千问
 */

const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const SYSTEM_PROMPT = `你是 TeamAgent 任务拆解助手。请将用户的任务描述拆解为结构化的子流程。

## 输出格式（必须是合法 JSON）
{
  "steps": [
    {
      "order": 1,
      "title": "子流程标题（简洁，10字以内）",
      "description": "详细描述",
      "assignees": ["人名1", "人名2"],
      "inputs": ["需要的输入/依赖"],
      "outputs": ["产出物"],
      "skills": ["可能需要的Skill"]
    }
  ]
}

## 拆解规则
1. 每个子流程应该是**可独立执行**的最小单元
2. 识别所有**人名**：
   - 中文名：2-3个汉字，如"小敏"、"段段"
   - 职位格式：如"于主任"、"李院长"
   - 英文名：如"Aurora"
   - 不要把"过来的"、"同时给"、"确定后"等词当成人名！
3. 明确每步的**输入依赖**和**输出产出**
4. 推断可能需要的 **Skill**（如：文档处理、代码编写、设计、会议安排等）
5. 如果描述中有"同时"、"并且"，考虑合并为一个步骤
6. 如果描述中有"要求"、"带上"等补充说明，合并到上一个步骤

## 示例
输入：小敏拆解于主任给过来的居家护理分析报告，设计出模版，同时给出prompt MD。给到段段讨论，确定后联系于主任开会，要求带上他们的康复师、报告师，邀约Aurora和李院参加

输出：
{
  "steps": [
    {
      "order": 1,
      "title": "拆解分析报告",
      "description": "小敏拆解于主任提供的居家护理分析报告",
      "assignees": ["小敏"],
      "inputs": ["于主任的居家护理分析报告"],
      "outputs": ["报告拆解结果"],
      "skills": ["文档分析"]
    },
    {
      "order": 2,
      "title": "设计模版",
      "description": "小敏设计模版，并给出 prompt MD",
      "assignees": ["小敏"],
      "inputs": ["报告拆解结果"],
      "outputs": ["模版设计", "Prompt MD"],
      "skills": ["模版设计", "Prompt编写"]
    },
    {
      "order": 3,
      "title": "讨论确认",
      "description": "将模版给到段段讨论并确认",
      "assignees": ["小敏", "段段"],
      "inputs": ["模版设计", "Prompt MD"],
      "outputs": ["确认的方案"],
      "skills": []
    },
    {
      "order": 4,
      "title": "安排会议",
      "description": "联系于主任安排会议，邀请康复师、报告师、Aurora、李院参加",
      "assignees": ["段段"],
      "inputs": ["确认的方案"],
      "outputs": ["会议安排"],
      "skills": ["日程管理"],
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

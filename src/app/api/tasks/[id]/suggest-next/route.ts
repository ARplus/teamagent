import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const SUGGEST_PROMPT = `你是 TeamAgent 智能助手。根据刚完成的任务，建议下一步应该做什么。

## 输出格式（JSON）
{
  "title": "建议的下一步任务标题",
  "description": "详细描述下一步需要做什么，用数字编号列出具体步骤",
  "reason": "为什么建议这个下一步"
}

## 规则
1. 基于已完成任务的产出物，思考后续需要做什么
2. 描述要具体、可执行
3. 用数字编号(1. 2. 3.)列出步骤，方便后续自动拆解

只输出 JSON。`

// POST /api/tasks/[id]/suggest-next - Agent 建议下一步
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const tokenAuth = await authenticateRequest(req)
    
    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }

    // 获取已完成的任务
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        workspace: true
      }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // 构建上下文
    const context = `
已完成的任务: ${task.title}

任务描述: ${task.description || '无'}

完成的步骤:
${task.steps.map(s => {
  const outputs = s.outputs ? JSON.parse(s.outputs) : []
  return `- ${s.title}${outputs.length > 0 ? ` (产出: ${outputs.join(', ')})` : ''}`
}).join('\n')}
`

    // 调用 AI 建议下一步
    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen-max',
        messages: [
          { role: 'system', content: SUGGEST_PROMPT },
          { role: 'user', content: context }
        ],
        temperature: 0.5
      })
    })

    if (!response.ok) {
      console.error('千问 API 错误')
      return NextResponse.json({ error: 'AI 服务错误' }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    let suggestion
    try {
      suggestion = JSON.parse(content)
    } catch {
      return NextResponse.json({ error: 'AI 返回格式错误' }, { status: 500 })
    }

    // 创建建议任务（status: suggested）
    const suggestedTask = await prisma.task.create({
      data: {
        title: suggestion.title,
        description: suggestion.description,
        status: 'suggested',
        priority: task.priority,
        creatorId: tokenAuth.user.id,
        assigneeId: task.assigneeId,
        workspaceId: task.workspaceId,
        parentTaskId: task.id  // 关联前置任务
      }
    })

    return NextResponse.json({
      message: '已生成下一步建议',
      suggestion: {
        ...suggestedTask,
        reason: suggestion.reason
      },
      parentTask: {
        id: task.id,
        title: task.title
      }
    })

  } catch (error) {
    console.error('建议下一步失败:', error)
    return NextResponse.json({ error: '生成建议失败' }, { status: 500 })
  }
}

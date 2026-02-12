import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }

  return null
}

// 简单的任务拆解（规则版，后续可接入大模型）
function parseTaskDescription(description: string) {
  const steps: { title: string; description: string; assignees: string[] }[] = []
  
  // 按数字编号拆分
  const lines = description.split(/\n/).filter(l => l.trim())
  
  for (const line of lines) {
    // 匹配 "1. xxx" 或 "1、xxx" 格式
    const match = line.match(/^\d+[.、]\s*(.+)/)
    if (match) {
      const content = match[1]
      
      // 提取人名（简单版：找中文2-3字的词，后面跟着动词）
      const namePattern = /([一-龥]{2,3})(?:出|设计|找|给|把|集成|联调|提供|上传|放入|更新)/g
      const assignees: string[] = []
      let nameMatch
      while ((nameMatch = namePattern.exec(content)) !== null) {
        if (!assignees.includes(nameMatch[1])) {
          assignees.push(nameMatch[1])
        }
      }
      
      steps.push({
        title: content.slice(0, 50) + (content.length > 50 ? '...' : ''),
        description: content,
        assignees
      })
    }
  }
  
  return steps
}

// POST /api/tasks/[id]/parse - AI 解析任务并创建步骤
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 获取任务
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { steps: true }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (!task.description) {
      return NextResponse.json({ error: '任务没有描述，无法解析' }, { status: 400 })
    }

    // 解析任务描述
    const parsedSteps = parseTaskDescription(task.description)

    if (parsedSteps.length === 0) {
      return NextResponse.json({ error: '无法从描述中识别步骤' }, { status: 400 })
    }

    // 获取工作区内所有用户（用于匹配昵称）
    const workspaceMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: {
          select: { id: true, name: true, nickname: true }
        }
      }
    })

    // 创建步骤
    const createdSteps = []
    let order = task.steps.length // 从现有步骤数量开始

    for (const step of parsedSteps) {
      order++
      
      // 尝试匹配负责人
      let assigneeId: string | null = null
      for (const assigneeName of step.assignees) {
        const member = workspaceMembers.find(m => 
          m.user.nickname === assigneeName || 
          m.user.name === assigneeName
        )
        if (member) {
          assigneeId = member.user.id
          break
        }
      }

      const created = await prisma.taskStep.create({
        data: {
          title: step.title,
          description: `负责人: ${step.assignees.join('、') || '待分配'}\n\n${step.description}`,
          order,
          taskId,
          assigneeId
        },
        include: {
          assignee: { select: { id: true, name: true, nickname: true } }
        }
      })

      createdSteps.push({
        ...created,
        recognizedAssignees: step.assignees
      })
    }

    return NextResponse.json({
      message: `成功创建 ${createdSteps.length} 个步骤`,
      steps: createdSteps
    })

  } catch (error) {
    console.error('解析任务失败:', error)
    return NextResponse.json({ error: '解析任务失败' }, { status: 500 })
  }
}

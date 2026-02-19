import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { parseTaskWithAI } from '@/lib/ai-parse'
import { sendToUsers } from '@/lib/events'

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

    // 使用 AI 解析任务描述
    console.log('开始 AI 拆解任务:', task.title)
    const parseResult = await parseTaskWithAI(task.description)

    if (!parseResult.success || !parseResult.steps) {
      return NextResponse.json({ 
        error: parseResult.error || '无法解析任务' 
      }, { status: 400 })
    }

    console.log('AI 拆解结果:', parseResult.steps.length, '个步骤')

    // 获取工作区内所有用户（用于匹配责任人）
    const workspaceMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: { select: { id: true, name: true, nickname: true } }
      }
    })

    // 创建步骤
    const createdSteps = []
    let order = task.steps.length

    for (const step of parseResult.steps) {
      order++
      
      // 尝试匹配主责任人
      let assigneeId: string | null = null
      for (const assigneeName of step.assignees) {
        const member = workspaceMembers.find(m => 
          m.user.nickname === assigneeName || 
          m.user.name === assigneeName ||
          m.user.name?.includes(assigneeName) ||
          assigneeName.includes(m.user.name || '')
        )
        if (member) {
          assigneeId = member.user.id
          break
        }
      }

      // 确保是数组格式
      const assignees = Array.isArray(step.assignees) ? step.assignees : [step.assignees].filter(Boolean)
      const inputs = Array.isArray(step.inputs) ? step.inputs : [step.inputs].filter(Boolean)
      const outputs = Array.isArray(step.outputs) ? step.outputs : [step.outputs].filter(Boolean)
      const skills = Array.isArray(step.skills) ? step.skills : [step.skills].filter(Boolean)

      const participants = Array.isArray(step.participants) ? step.participants : []

      const created = await prisma.taskStep.create({
        data: {
          title: step.title,
          description: step.description,
          order,
          taskId,
          assigneeId,
          assigneeNames: JSON.stringify(assignees),
          inputs: JSON.stringify(inputs),
          outputs: JSON.stringify(outputs),
          skills: JSON.stringify(skills),
          status: 'pending',
          agentStatus: assigneeId ? 'pending' : null,
          stepType: step.stepType || 'task',
          agenda: step.agenda || null,
          participants: participants.length > 0 ? JSON.stringify(participants) : null,
        },
        include: {
          assignee: { select: { id: true, name: true, nickname: true } }
        }
      })

      createdSteps.push({
        ...created,
        assigneeNames: step.assignees,
        inputs: step.inputs,
        outputs: step.outputs,
        skills: step.skills
      })
    }

    // 🔔 通知所有相关的 Agent
    // 收集所有被分配的用户 ID（去重）
    const involvedUserIds = new Set<string>()
    
    for (const step of createdSteps) {
      if (step.assigneeId) {
        involvedUserIds.add(step.assigneeId)
      }
    }

    // 通知每个相关用户
    if (involvedUserIds.size > 0) {
      const userIds = Array.from(involvedUserIds)
      
      // 给每个用户发送任务通知
      sendToUsers(userIds, {
        type: 'task:created',
        taskId: task.id,
        title: task.title
      })

      // 通知第一个步骤的负责人：可以开始了！
      const firstStep = createdSteps[0]
      if (firstStep?.assigneeId) {
        sendToUsers([firstStep.assigneeId], {
          type: 'step:ready',
          taskId: task.id,
          stepId: firstStep.id,
          title: firstStep.title
        })
      }

      console.log(`[Parse] 已通知 ${userIds.length} 个相关 Agent`)
    }

    return NextResponse.json({
      message: `🤖 AI 成功拆解为 ${createdSteps.length} 个步骤，已通知 ${involvedUserIds.size} 个相关 Agent`,
      steps: createdSteps,
      involvedAgents: involvedUserIds.size
    })

  } catch (error) {
    console.error('解析任务失败:', error)
    return NextResponse.json({ error: '解析任务失败' }, { status: 500 })
  }
}

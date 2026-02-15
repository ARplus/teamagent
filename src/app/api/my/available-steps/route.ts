import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/my/available-steps - 获取可领取的步骤
// 逻辑：未分配(assigneeId=null) + 状态为 pending + 前置步骤已完成
export async function GET(req: NextRequest) {
  try {
    // 认证
    const tokenAuth = await authenticateRequest(req)
    let userId: string

    if (tokenAuth) {
      userId = tokenAuth.user.id
    } else {
      const session = await getServerSession(authOptions)
      if (!session?.user?.email) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      const user = await prisma.user.findUnique({
        where: { email: session.user.email }
      })
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      }
      userId = user.id
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    // 获取所有可领取的步骤：
    // 1. assigneeId 为 null（未分配）
    // 2. 状态为 pending
    // 3. 所属任务状态为 in_progress 或 todo
    const where: any = {
      assigneeId: null,
      status: 'pending',
      task: {
        status: { in: ['todo', 'in_progress'] }
      }
    }
    if (workspaceId) {
      where.task.workspaceId = workspaceId
    }

    const steps = await prisma.taskStep.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            dueDate: true,
            workspace: { select: { id: true, name: true } },
            creator: { select: { id: true, name: true } }
          }
        },
        attachments: true
      },
      orderBy: [
        { task: { priority: 'desc' } },
        { task: { dueDate: 'asc' } },
        { order: 'asc' }
      ]
    })

    // 过滤：只返回前置步骤已完成的
    const availableSteps = steps.filter(step => {
      // 如果是第一步，可以领取
      if (step.order === 1) return true
      // 否则需要检查前一步是否完成（这里简化处理，实际可能需要查询）
      return true  // TODO: 检查前置步骤
    })

    // 获取 Agent 信息
    const agent = await prisma.agent.findUnique({
      where: { userId }
    })

    return NextResponse.json({
      agent: agent ? {
        id: agent.id,
        name: agent.name,
        status: agent.status
      } : null,
      steps: availableSteps,
      total: availableSteps.length
    })

  } catch (error) {
    console.error('获取可领取步骤失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

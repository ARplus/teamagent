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

    // 获取用户所在的工作区列表（用于过滤步骤）
    const userWorkspaces = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true }
    })
    const userWorkspaceIds = userWorkspaces.map(w => w.workspaceId)

    // 获取所有可领取的步骤：
    // 1. assigneeId 为 null（未分配）
    // 2. 状态为 pending
    // 3. 所属任务状态为 in_progress 或 todo
    // 4. 只返回用户所在工作区的步骤（workspace isolation）
    const where: any = {
      assigneeId: null,
      status: 'pending',
      task: {
        status: { in: ['todo', 'in_progress'] },
        workspaceId: workspaceId
          ? workspaceId  // 指定工作区
          : { in: userWorkspaceIds }  // 默认：只看自己的工作区
      }
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
    // 获取这些步骤所属任务的所有步骤（用于前序检查）
    const taskIds = [...new Set(steps.map(s => s.taskId))]
    const allTaskSteps = taskIds.length > 0 ? await prisma.taskStep.findMany({
      where: { taskId: { in: taskIds } },
      select: { id: true, taskId: true, order: true, status: true },
    }) : []

    const availableSteps = steps.filter(step => {
      if (step.order <= 1) return true
      // 同任务中 order 更小的步骤必须全部 "不阻塞"
      // 与 claim 路由保持一致：done/skipped/waiting_approval/waiting_human 不阻塞
      const predecessors = allTaskSteps.filter(
        s => s.taskId === step.taskId && s.order < step.order
      )
      const nonBlockingStatuses = ['done', 'completed', 'approved', 'skipped', 'waiting_approval', 'waiting_human']
      return predecessors.every(p => nonBlockingStatuses.includes(p.status))
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

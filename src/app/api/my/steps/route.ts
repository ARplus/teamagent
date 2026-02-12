import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// GET /api/my/steps - 获取分配给我的步骤
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

    // 获取查询参数
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') // pending, in_progress, waiting_approval, done
    const taskId = searchParams.get('taskId')

    // 构建查询条件
    const where: any = {
      assigneeId: userId
    }
    if (status) {
      where.status = status
    }
    if (taskId) {
      where.taskId = taskId
    }

    // 获取步骤
    const steps = await prisma.taskStep.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            workspace: { select: { id: true, name: true } }
          }
        },
        attachments: true
      },
      orderBy: [
        { task: { createdAt: 'desc' } },
        { order: 'asc' }
      ]
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
      steps,
      total: steps.length
    })
  } catch (error) {
    console.error('获取步骤失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

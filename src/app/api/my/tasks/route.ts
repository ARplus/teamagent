import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// GET /api/my/tasks - 获取分配给我的任务
export async function GET(req: NextRequest) {
  try {
    // 先尝试 API Token 认证
    const tokenAuth = await authenticateRequest(req)
    let userId: string

    if (tokenAuth) {
      userId = tokenAuth.user.id
    } else {
      // 尝试 Session 认证
      const session = await getServerSession(authOptions)
      if (!session?.user?.email) {
        return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
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
    const status = searchParams.get('status') // todo, in_progress, review, done
    const workspaceId = searchParams.get('workspaceId')

    // 构建查询条件
    const where: any = {
      assigneeId: userId
    }
    if (status) {
      where.status = status
    }
    if (workspaceId) {
      where.workspaceId = workspaceId
    }

    // 获取任务
    const tasks = await prisma.task.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        workspace: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    })

    // 获取用户的 Agent 信息
    const agent = await prisma.agent.findUnique({
      where: { userId }
    })

    return NextResponse.json({
      agent: agent ? {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        status: agent.status
      } : null,
      tasks,
      total: tasks.length
    })
  } catch (error) {
    console.error('获取任务失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

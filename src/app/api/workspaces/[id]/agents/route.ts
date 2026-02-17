import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/workspaces/[id]/agents
 * 
 * 获取工作区内所有成员的 Agent 状态
 * 返回在线状态、最后活跃时间等
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 验证用户是工作区成员
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: '无权访问此工作区' }, { status: 403 })
    }

    // 获取工作区所有成员及其 Agent
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            nickname: true,
            avatar: true,
            agent: {
              select: {
                id: true,
                name: true,
                avatar: true,
                status: true,
                updatedAt: true
              }
            }
          }
        }
      }
    })

    // 格式化返回数据
    const agents = members.map(m => {
      const agent = m.user.agent
      const now = new Date()
      
      // 判断是否最近活跃（5分钟内更新过状态视为活跃）
      let isActive = false
      let lastSeenText = '从未'
      
      if (agent?.updatedAt) {
        const diff = now.getTime() - new Date(agent.updatedAt).getTime()
        const minutes = Math.floor(diff / 60000)
        
        if (minutes < 5) {
          isActive = agent.status === 'online' || agent.status === 'working'
          lastSeenText = '刚刚'
        } else if (minutes < 60) {
          lastSeenText = `${minutes}分钟前`
        } else if (minutes < 1440) {
          lastSeenText = `${Math.floor(minutes / 60)}小时前`
        } else {
          lastSeenText = `${Math.floor(minutes / 1440)}天前`
        }
      }

      return {
        userId: m.user.id,
        userName: m.user.nickname || m.user.name || '未命名',
        userImage: m.user.avatar,
        role: m.role,
        agent: agent ? {
          id: agent.id,
          name: agent.name,
          avatar: agent.avatar,
          status: agent.status,
          isActive,
          lastSeen: agent.updatedAt,
          lastSeenText
        } : null
      }
    })

    // 统计
    const stats = {
      total: agents.length,
      online: agents.filter(a => a.agent?.isActive).length,
      withAgent: agents.filter(a => a.agent).length
    }

    return NextResponse.json({
      workspaceId,
      agents,
      stats
    })

  } catch (error) {
    console.error('获取工作区 Agent 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

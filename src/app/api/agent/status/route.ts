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

// GET /api/agent/status - 获取当前用户的 Agent 状态
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const agent = await prisma.agent.findUnique({
      where: { userId: auth.userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    }

    // 根据 lastHeartbeatAt 判断真实状态：超过 3 分钟无心跳视为离线
    // （Agent Worker 每 60s 发一次心跳，3min = 允许 3 次失败）
    let effectiveStatus = agent.status
    if (agent.status === 'online' || agent.status === 'working') {
      // 优先用 lastHeartbeatAt，无心跳记录则用 updatedAt（兼容旧数据）
      const heartbeatTime = (agent as any).lastHeartbeatAt ?? agent.updatedAt
      const diff = Date.now() - new Date(heartbeatTime).getTime()
      const TIMEOUT_MS = 3 * 60 * 1000 // 3分钟
      if (diff > TIMEOUT_MS) {
        effectiveStatus = 'offline'
        // 异步更新数据库（不阻塞响应），同步子 Agent 状态
        prisma.agent.update({
          where: { id: agent.id },
          data: { status: 'offline' }
        }).then(() => {
          if (!agent.parentAgentId) {
            prisma.agent.updateMany({
              where: { parentAgentId: agent.id },
              data: { status: 'offline' },
            }).catch(() => {})
          }
        }).catch(() => {})
      }
    }

    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      status: effectiveStatus,
      lastHeartbeatAt: (agent as any).lastHeartbeatAt,
      updatedAt: agent.updatedAt
    })

  } catch (error) {
    console.error('获取 Agent 状态失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

// PATCH /api/agent/status - 更新 Agent 状态（Skill 调用）
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { status } = await req.json()

    // 允许的状态值
    const validStatuses = ['online', 'working', 'waiting', 'offline', 'error']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: '无效的状态值' }, { status: 400 })
    }

    const agent = await prisma.agent.update({
      where: { userId: auth.userId },
      data: {
        status,
        // 在线/工作状态同步更新心跳时间，供 SSE 断连时判断是否真的离线
        ...(['online', 'working'].includes(status) ? { lastHeartbeatAt: new Date() } : {})
      }
    })

    // 影子军团同步：主 Agent 状态变更时，自动同步所有子 Agent 到相同状态
    if (!agent.parentAgentId) {
      await prisma.agent.updateMany({
        where: { parentAgentId: agent.id },
        data: { status },
      }).catch(() => {})
    }

    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      message: `状态已更新为 ${status}`
    })

  } catch (error) {
    console.error('更新 Agent 状态失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

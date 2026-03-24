import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/my-learning
 * 获取当前用户（及其 Agent）的学习档案
 * 返回：自己的课程列表 + Agent 的课程列表 + 统计
 */
export async function GET(req: NextRequest) {
  // 统一认证：API Token 或 Session
  let userId: string | null = null
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    userId = tokenAuth.user.id
  } else {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      userId = u?.id || null
    }
  }

  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  // 1. 查当前用户的 Agent
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      nickname: true,
      agent: { select: { id: true, name: true, userId: true } },
    },
  })

  // 2. 获取所有报名记录（不再按 enrolledByAgentId 拆分）
  // Aurora 和 Lobster 共享同一 userId，所有课程都应可见
  const allEnrollments = await prisma.courseEnrollment.findMany({
    where: { userId },
    orderBy: { enrolledAt: 'desc' },
    select: {
      id: true,
      status: true,
      progress: true,
      enrolledAt: true,
      completedAt: true,
      enrolledByAgentId: true,
      template: {
        select: {
          id: true,
          name: true,
          courseType: true,
          coverImage: true,
          difficulty: true,
          department: true,
          creator: { select: { id: true, name: true, nickname: true } },
        },
      },
      examSubmission: { select: { id: true, totalScore: true, passed: true } },
    },
  })

  // 3. 统计（合并统计，不再区分人类/Agent）
  const stats = {
    total: allEnrollments.length,
    completed: allEnrollments.filter(e => e.status === 'completed' || e.status === 'graduated').length,
    learning: allEnrollments.filter(e => e.status === 'learning' || e.status === 'enrolled').length,
    passed: allEnrollments.filter(e => e.examSubmission?.passed).length,
  }

  // 向下兼容：也拆分出 myEnrollments/agentEnrollments（旧前端可能还用）
  const myEnrollments = allEnrollments.filter(e => !e.enrolledByAgentId)
  const agentEnrollments = allEnrollments.filter(e => !!e.enrolledByAgentId)

  return NextResponse.json({
    user: {
      id: user?.id,
      name: user?.nickname || user?.name,
    },
    agent: user?.agent ? {
      id: user.agent.id,
      name: user.agent.name,
    } : null,
    allEnrollments,
    myEnrollments,
    agentEnrollments,
    stats,
    myStats: {
      total: myEnrollments.length,
      completed: myEnrollments.filter(e => e.status === 'completed' || e.status === 'graduated').length,
      learning: myEnrollments.filter(e => e.status === 'learning' || e.status === 'enrolled').length,
      passed: myEnrollments.filter(e => e.examSubmission?.passed).length,
    },
    agentStats: {
      total: agentEnrollments.length,
      completed: agentEnrollments.filter(e => e.status === 'completed' || e.status === 'graduated').length,
      learning: agentEnrollments.filter(e => e.status === 'learning' || e.status === 'enrolled').length,
      passed: agentEnrollments.filter(e => e.examSubmission?.passed).length,
    },
  })
}

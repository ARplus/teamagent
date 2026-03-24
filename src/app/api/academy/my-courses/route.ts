import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

/**
 * GET /api/academy/my-courses — 我的课程
 *
 * 返回当前用户报名的所有课程 + 进度 + 状态
 *
 * 查询参数:
 *   status: enrolled | learning | completed | graduated（筛选）
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status')

    const where: any = { userId: auth.userId }
    if (statusFilter) {
      where.status = statusFilter
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where,
      select: {
        id: true,
        status: true,
        progress: true,
        paidTokens: true,
        enrolledAt: true,
        completedAt: true,
        completedSteps: true,
        enrolledByAgentId: true,
        template: {
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            category: true,
            courseType: true,
            price: true,
            coverImage: true,
            difficulty: true,
            department: true,
            tags: true,
            stepsTemplate: true,
            creator: {
              select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true } } }
            },
            workspace: {
              select: { id: true, name: true }
            },
            _count: {
              select: { enrollments: true }
            },
            examTemplate: true,
          },
        },
        examSubmission: {
          select: { id: true, gradingStatus: true, passed: true },
        },
        task: {
          select: {
            id: true,
            status: true,
            steps: {
              select: {
                id: true,
                title: true,
                status: true,
                order: true,
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    })

    // 查当前用户的 Agent 信息（用于标注学习者）
    const userAgent = await prisma.agent.findUnique({
      where: { userId: auth.userId },
      select: { id: true, name: true },
    })

    // 格式化
    const result = enrollments.map(e => {
      let stepsCount = 0
      try {
        const steps = JSON.parse(e.template.stepsTemplate)
        stepsCount = Array.isArray(steps) ? steps.length : 0
      } catch {}

      // 解析已完成步骤
      let parsedCompletedSteps: number[] = []
      if (e.completedSteps) {
        try { parsedCompletedSteps = JSON.parse(e.completedSteps) } catch {}
      }

      return {
        enrollmentId: e.id,
        status: e.status,
        progress: e.progress,
        completedSteps: parsedCompletedSteps,
        paidTokens: e.paidTokens,
        enrolledAt: e.enrolledAt,
        completedAt: e.completedAt,
        // 学习者标识（人类和 Agent 共享 userId，一门课两个人都能学）
        learners: [
          { type: 'human' as const, name: (auth.user as any)?.name || '我' },
          ...(e.enrolledByAgentId && userAgent
            ? [{ type: 'agent' as const, name: userAgent.name, agentId: userAgent.id }]
            : []),
        ],
        course: {
          id: e.template.id,
          name: e.template.name,
          description: e.template.description,
          icon: e.template.icon,
          courseType: e.template.courseType,
          price: e.template.price,
          coverImage: e.template.coverImage,
          difficulty: e.template.difficulty,
          department: e.template.department,
          tags: e.template.tags,
          stepsCount,
          enrollCount: e.template._count.enrollments,
          creator: e.template.creator,
          workspace: e.template.workspace,
          hasExam: !!e.template.examTemplate,
        },
        examSubmission: e.examSubmission ? {
          id: e.examSubmission.id,
          gradingStatus: e.examSubmission.gradingStatus,
          passed: e.examSubmission.passed,
        } : null,
        task: e.task ? {
          id: e.task.id,
          status: e.task.status,
          steps: e.task.steps,
        } : null,
      }
    })

    return NextResponse.json({ courses: result })
  } catch (error) {
    console.error('[Academy/MyCourses/GET] 失败:', error)
    return NextResponse.json({ error: '获取我的课程失败' }, { status: 500 })
  }
}

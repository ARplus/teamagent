import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/my-created-courses/students
 *
 * 创建者看板：查看我创建的课程的选课学生、进度、收入
 * 需要登录（Session 或 Bearer Token）
 *
 * 查询参数：
 *   courseId: 指定课程 ID（可选，不传返回所有课程汇总）
 */
export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null

    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
    }
    if (!userId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
        userId = user?.id || null
      }
    }
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const courseId = searchParams.get('courseId')

    // 查找我创建的课程
    const whereTemplate: any = {
      creatorId: userId,
      courseType: { not: null },
    }
    if (courseId) {
      whereTemplate.id = courseId
    }

    const myCourses = await prisma.taskTemplate.findMany({
      where: whereTemplate,
      include: {
        enrollments: {
          include: {
            user: {
              select: {
                id: true, name: true, avatar: true, email: true,
                agent: { select: { id: true, name: true, avatar: true, parentAgentId: true } },
              },
            },
            examSubmission: {
              select: {
                id: true,
                autoScore: true,
                manualScore: true,
                totalScore: true,
                maxScore: true,
                passed: true,
                gradingStatus: true,
                answers: true,
                submittedAt: true,
              },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        },
        _count: {
          select: { enrollments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // 汇总数据
    let totalStudents = 0
    let totalRevenue = 0
    let totalCompleted = 0

    const courses = myCourses.map(c => {
      let stepsCount = 0
      try {
        const steps = JSON.parse(c.stepsTemplate)
        stepsCount = Array.isArray(steps) ? steps.length : 0
      } catch {}

      const courseRevenue = c.enrollments.reduce((sum, e) => sum + (e.paidTokens || 0), 0)
      const courseCompleted = c.enrollments.filter(e => e.status === 'completed' || e.status === 'graduated').length

      totalStudents += c._count.enrollments
      totalRevenue += courseRevenue
      totalCompleted += courseCompleted

      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        courseType: c.courseType,
        price: c.price,
        reviewStatus: c.reviewStatus,
        stepsCount,
        studentCount: c._count.enrollments,
        completedCount: courseCompleted,
        revenue: courseRevenue,
        students: c.enrollments.map(e => {
          // 学员类型判断：
          // 1. enrolledByAgentId 有值 → 由 Agent 报名（即使 userId 和人类相同）
          // 2. parentAgentId 不为空 → 子Agent
          // 3. 其他 → 人类
          const agentRecord = (e.user as any).agent
          const isSubAgent = !!(agentRecord?.parentAgentId)
          const isAgentEnrolled = !!(e as any).enrolledByAgentId
          const isAgent = isSubAgent || isAgentEnrolled
          const userType: 'human' | 'agent' = isAgent ? 'agent' : 'human'
          const displayAgentName = isSubAgent ? agentRecord?.name : (isAgentEnrolled ? agentRecord?.name : null)
          return {
            userId: e.user.id,
            name: isAgent ? (displayAgentName || agentRecord?.name || e.user.name) : e.user.name,
            avatar: isAgent ? (agentRecord?.avatar || e.user.avatar) : e.user.avatar,
            email: e.user.email,
            userType,
            isAgent,
            agentName: displayAgentName || (isAgentEnrolled ? agentRecord?.name : null),
            humanName: e.user.name,
            status: e.status,
            progress: e.progress,
            paidTokens: e.paidTokens,
            enrolledAt: e.enrolledAt,
            completedAt: e.completedAt,
            exam: e.examSubmission ? {
              submissionId: e.examSubmission.id,
              totalScore: e.examSubmission.totalScore,
              maxScore: e.examSubmission.maxScore,
              passed: e.examSubmission.passed,
              gradingStatus: e.examSubmission.gradingStatus,
              submittedAt: e.examSubmission.submittedAt,
            } : null,
          }
        }),
      }
    })

    return NextResponse.json({
      summary: {
        totalCourses: myCourses.length,
        totalStudents,
        totalRevenue,
        totalCompleted,
        completionRate: totalStudents > 0 ? Math.round((totalCompleted / totalStudents) * 100) : 0,
      },
      courses,
    })
  } catch (error) {
    console.error('[Academy/CreatorDashboard] 失败:', error)
    return NextResponse.json({ error: '获取看板数据失败' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/agent-profile?userId=xxx
 *
 * Agent 学习档案：已完成课程、考试成绩、已解锁 Principle 列表
 * 支持查看自己的档案（userId=me 或不传）或指定 Agent 的档案
 * 需要登录（Session 或 Bearer Token）
 */
export async function GET(req: NextRequest) {
  try {
    let viewerUserId: string | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) viewerUserId = tokenAuth.user.id
    if (!viewerUserId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
        viewerUserId = user?.id || null
      }
    }
    if (!viewerUserId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const targetUserId = searchParams.get('userId') || viewerUserId

    // 查目标 Agent 信息
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true, name: true, avatar: true,
        agent: { select: { id: true, name: true, avatar: true, status: true, capabilities: true } },
      },
    })
    if (!targetUser) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    // 查所有报名记录（含考试成绩和 Principle）
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId: targetUserId },
      include: {
        template: {
          select: {
            id: true, name: true, icon: true, courseType: true, difficulty: true,
            principleTemplate: true,
            creator: { select: { id: true, name: true, avatar: true } },
          },
        },
        examSubmission: {
          select: {
            id: true, totalScore: true, maxScore: true, passed: true,
            gradingStatus: true, submittedAt: true, gradedBy: true,
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    })

    // 分组整理
    const graduated = enrollments.filter(e => e.status === 'graduated' || e.status === 'completed')
    const inProgress = enrollments.filter(e => e.status === 'enrolled' || e.status === 'learning')

    // 已解锁 Principle（graduated + principleDelivered=true）
    const unlockedPrinciples = graduated
      .filter(e => e.principleDelivered && e.template.principleTemplate)
      .map(e => {
        // 从模板提取 Principle 文件名/标题（principleTemplate 首行 ## 标题 或文件名格式）
        const pt = e.template.principleTemplate || ''
        const titleMatch = pt.match(/^#+ (.+)/m)
        const principleTitle = titleMatch?.[1]?.trim() || e.template.name + '·Principle'
        return {
          courseId: e.template.id,
          courseName: e.template.name,
          courseIcon: e.template.icon,
          principleTitle,
          unlockedAt: e.principleDeliveredAt,
        }
      })

    // 统计
    const stats = {
      totalEnrolled: enrollments.length,
      totalGraduated: graduated.length,
      totalPrinciples: unlockedPrinciples.length,
      avgScore: (() => {
        const graded = enrollments.filter(e => e.examSubmission?.totalScore != null)
        if (graded.length === 0) return null
        const sum = graded.reduce((s, e) => s + (e.examSubmission!.totalScore! / e.examSubmission!.maxScore * 100), 0)
        return Math.round(sum / graded.length)
      })(),
    }

    return NextResponse.json({
      agent: {
        userId: targetUser.id,
        userName: targetUser.name,
        agentName: targetUser.agent?.name || targetUser.name,
        avatar: targetUser.agent?.avatar || targetUser.avatar,
        status: targetUser.agent?.status,
        capabilities: targetUser.agent?.capabilities || [],
      },
      stats,
      graduated: graduated.map(e => ({
        enrollmentId: e.id,
        course: {
          id: e.template.id,
          name: e.template.name,
          icon: e.template.icon,
          courseType: e.template.courseType,
          difficulty: e.template.difficulty,
          creator: e.template.creator,
        },
        completedAt: e.completedAt,
        principleDelivered: e.principleDelivered,
        exam: e.examSubmission ? {
          id: e.examSubmission.id,
          totalScore: e.examSubmission.totalScore,
          maxScore: e.examSubmission.maxScore,
          passed: e.examSubmission.passed,
          gradingStatus: e.examSubmission.gradingStatus,
          submittedAt: e.examSubmission.submittedAt,
        } : null,
      })),
      inProgress: inProgress.map(e => ({
        enrollmentId: e.id,
        course: {
          id: e.template.id,
          name: e.template.name,
          icon: e.template.icon,
          difficulty: e.template.difficulty,
        },
        progress: e.progress,
        enrolledAt: e.enrolledAt,
      })),
      unlockedPrinciples,
    })
  } catch (error) {
    console.error('[Academy/AgentProfile] 失败:', error)
    return NextResponse.json({ error: '获取档案失败' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/exam/grading-queue
 * 创建者待批改列表
 */
export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) userId = tokenAuth.user.id
    if (!userId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
        userId = user?.id || null
      }
    }
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // 查询该用户创建的课程中待批改的提交
    const submissions = await prisma.examSubmission.findMany({
      where: {
        gradingStatus: 'manual_grading',
        template: { creatorId: userId },
      },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        template: { select: { id: true, name: true, icon: true, examTemplate: true, examPassScore: true } },
        enrollment: { select: { id: true, progress: true } },
      },
      orderBy: { submittedAt: 'asc' },
    })

    return NextResponse.json({
      queue: submissions.map(s => ({
        ...s,
        answers: JSON.parse(s.answers || '[]'),
      })),
      total: submissions.length,
    })
  } catch (error) {
    console.error('[Academy/Exam/GradingQueue] 失败:', error)
    return NextResponse.json({ error: '获取批改队列失败' }, { status: 500 })
  }
}

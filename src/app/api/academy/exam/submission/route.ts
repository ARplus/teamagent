import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/exam/submission?enrollmentId=xxx
 * 查询考试结果
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

    const { searchParams } = new URL(req.url)
    const enrollmentId = searchParams.get('enrollmentId')
    if (!enrollmentId) return NextResponse.json({ error: '缺少 enrollmentId' }, { status: 400 })

    // 验证是本人或课程创建者
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { id: enrollmentId },
      include: { template: { select: { creatorId: true } } },
    })
    if (!enrollment) return NextResponse.json({ error: '未找到报名记录' }, { status: 404 })

    const isOwner = enrollment.userId === userId
    const isCreator = enrollment.template.creatorId === userId
    if (!isOwner && !isCreator) return NextResponse.json({ error: '无权查看' }, { status: 403 })

    const submission = await prisma.examSubmission.findUnique({
      where: { enrollmentId },
      include: {
        user: { select: { id: true, name: true } },
        template: { select: { id: true, name: true, icon: true, examTemplate: true } },
      },
    })

    if (!submission) {
      return NextResponse.json({ submission: null })
    }

    // 解析考试模板中的题目信息，补充 type/options/correct 到 answers
    let examQuestions: any[] = []
    if (submission.template?.examTemplate) {
      try {
        const exam = typeof submission.template.examTemplate === 'string'
          ? JSON.parse(submission.template.examTemplate) : submission.template.examTemplate
        examQuestions = exam.questions || []
      } catch {}
    }

    const rawAnswers = JSON.parse(submission.answers || '[]')
    // 合并题目信息到答案：确保 type、options、correct 从模板获取
    const enrichedAnswers = rawAnswers.map((ans: any) => {
      const q = examQuestions.find((qq: any) => qq.id === ans.questionId)
      if (!q) return ans
      return {
        ...ans,
        question: ans.question || q.title,
        type: q.type, // 用模板中的原始类型
        options: q.options || ans.options,
        correct: q.correctAnswer || ans.correct,
        score: q.points ?? ans.score,
      }
    })

    return NextResponse.json({
      submission: {
        ...submission,
        answers: enrichedAnswers,
        matchReport: submission.matchReport ? JSON.parse(submission.matchReport) : null,
        template: { id: submission.template?.id, name: submission.template?.name, icon: submission.template?.icon },
      },
    })
  } catch (error) {
    console.error('[Academy/Exam/Submission] 失败:', error)
    return NextResponse.json({ error: '查询考试结果失败' }, { status: 500 })
  }
}

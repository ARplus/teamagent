import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'

// Professor Lobster 的 userId — 投诉仲裁人
// 用 email 查找，fallback 到第一个 admin
async function getLobsterUserId(): Promise<string | null> {
  // 先找 Professor Lobster 的 Agent
  const lobster = await prisma.agent.findFirst({
    where: { name: { contains: 'Lobster' } },
    select: { userId: true },
  })
  if (lobster?.userId) return lobster.userId

  // fallback: 工作区 owner
  const owner = await prisma.workspaceMember.findFirst({
    where: { role: 'owner' },
    select: { userId: true },
    orderBy: { id: 'asc' },
  })
  return owner?.userId || null
}

/**
 * POST /api/academy/exam/complaint
 * 学生投诉考试评分
 * Body: { submissionId, complaintText }
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json()
    const { submissionId, complaintText } = body
    if (!submissionId || !complaintText?.trim()) {
      return NextResponse.json({ error: '缺少 submissionId 或 complaintText' }, { status: 400 })
    }

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        template: { select: { name: true } },
        user: { select: { name: true } },
      },
    })
    if (!submission) return NextResponse.json({ error: '未找到考试记录' }, { status: 404 })
    if (submission.userId !== userId) return NextResponse.json({ error: '只能投诉自己的考试' }, { status: 403 })
    if (submission.gradingStatus !== 'graded') return NextResponse.json({ error: '考试尚未批改完成' }, { status: 400 })

    await prisma.examSubmission.update({
      where: { id: submissionId },
      data: {
        complaintText: complaintText.trim(),
        complaintStatus: 'pending',
      },
    })

    // 通知 Professor Lobster
    const lobsterUserId = await getLobsterUserId()
    if (lobsterUserId) {
      sendToUser(lobsterUserId, {
        type: 'exam:complaint' as any,
        submissionId,
        courseName: submission.template.name,
        studentName: submission.user?.name || '学员',
        complaintText: complaintText.trim(),
      })
    }

    return NextResponse.json({ success: true, message: '投诉已提交，Professor Lobster 将审核处理' })
  } catch (error) {
    console.error('[Academy/Exam/Complaint] 失败:', error)
    return NextResponse.json({ error: '提交投诉失败' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'

/**
 * PATCH /api/academy/exam/resolve-complaint
 * Professor Lobster 仲裁投诉
 * Body: { submissionId, decision: 'resolved' | 'dismissed', adjustedScore?, complaintNote }
 */
export async function PATCH(req: NextRequest) {
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
    const { submissionId, decision, adjustedScore, complaintNote } = body
    if (!submissionId || !decision) {
      return NextResponse.json({ error: '缺少 submissionId 或 decision' }, { status: 400 })
    }
    if (!['resolved', 'dismissed'].includes(decision)) {
      return NextResponse.json({ error: 'decision 必须是 resolved 或 dismissed' }, { status: 400 })
    }

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        template: { select: { id: true, name: true, creatorId: true, examPassScore: true } },
      },
    })
    if (!submission) return NextResponse.json({ error: '未找到考试记录' }, { status: 404 })
    if (submission.complaintStatus !== 'pending') {
      return NextResponse.json({ error: '该投诉不在待处理状态' }, { status: 400 })
    }

    const updateData: any = {
      complaintStatus: decision,
      complaintNote: complaintNote || null,
    }

    // 调分（resolved + adjustedScore）
    if (decision === 'resolved' && adjustedScore !== undefined && adjustedScore !== null) {
      const newTotal = Number(adjustedScore)
      const passScore = submission.template.examPassScore || 60
      const passed = (newTotal / submission.maxScore * 100) >= passScore
      updateData.totalScore = newTotal
      updateData.passed = passed

      // 更新 enrollment 状态
      if (passed) {
        await prisma.courseEnrollment.update({
          where: { id: submission.enrollmentId },
          data: { status: 'graduated' },
        })
      }
    }

    await prisma.examSubmission.update({
      where: { id: submissionId },
      data: updateData,
    })

    // 通知学生
    sendToUser(submission.userId, {
      type: 'exam:complaint-resolved' as any,
      submissionId,
      courseName: submission.template.name,
      decision,
      complaintNote: complaintNote || '',
      adjustedScore: decision === 'resolved' ? adjustedScore : undefined,
    })

    // 通知课程创建者
    sendToUser(submission.template.creatorId, {
      type: 'exam:complaint-resolved' as any,
      submissionId,
      courseName: submission.template.name,
      decision,
      complaintNote: complaintNote || '',
    })

    return NextResponse.json({ success: true, decision })
  } catch (error) {
    console.error('[Academy/Exam/ResolveComplaint] 失败:', error)
    return NextResponse.json({ error: '仲裁失败' }, { status: 500 })
  }
}

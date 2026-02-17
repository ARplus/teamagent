import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/steps/[id]/history
 * 
 * 获取步骤的提交历史
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // 支持 API Token 或 Session 认证
    const tokenAuth = await authenticateRequest(req)
    const session = await getServerSession(authOptions)
    
    if (!tokenAuth && !session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: {
          select: { id: true, title: true, creatorId: true }
        }
      }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 获取所有提交记录（倒序）
    const submissions = await prisma.stepSubmission.findMany({
      where: { stepId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        submitter: {
          select: { id: true, name: true, email: true }
        },
        attachments: true
      }
    })

    // 如果有 reviewedBy，获取审核人信息
    const reviewerIds = submissions
      .filter(s => s.reviewedBy)
      .map(s => s.reviewedBy as string)
    
    const reviewers = reviewerIds.length > 0 
      ? await prisma.user.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, name: true, email: true }
        })
      : []

    const reviewerMap = new Map(reviewers.map(r => [r.id, r]))

    // 组装结果
    const history = submissions.map(s => ({
      id: s.id,
      result: s.result,
      summary: s.summary,
      status: s.status,
      createdAt: s.createdAt,
      durationMs: s.durationMs,
      submitter: s.submitter,
      reviewedAt: s.reviewedAt,
      reviewedBy: s.reviewedBy ? reviewerMap.get(s.reviewedBy) : null,
      reviewNote: s.reviewNote,
      attachments: s.attachments
    }))

    return NextResponse.json({
      step: {
        id: step.id,
        title: step.title,
        status: step.status,
        rejectionCount: step.rejectionCount
      },
      history,
      total: history.length
    })

  } catch (error) {
    console.error('获取提交历史失败:', error)
    return NextResponse.json({ error: '获取失败' }, { status: 500 })
  }
}

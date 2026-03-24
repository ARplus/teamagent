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

    // 获取 viewer userId
    let viewerUserId: string | null = null
    if (tokenAuth) {
      viewerUserId = tokenAuth.user.id
    } else if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      viewerUserId = u?.id ?? null
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: {
          select: { id: true, title: true, creatorId: true, mode: true }
        },
        assignees: { select: { userId: true } }
      }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 隐私遮罩：team 任务 requiresApproval 步骤，只有己方可看历史，对方须等 done
    const isTeamTask = (step.task as any)?.mode === 'team'
    const isStepAssignee = viewerUserId != null && (
      step.assigneeId === viewerUserId ||
      ((step as any).assignees?.some((a: any) => a.userId === viewerUserId) ?? false)
    )
    const isTaskCreator = viewerUserId != null && viewerUserId === step.task?.creatorId
    const canSeeResult = isTeamTask
      ? isStepAssignee
      : (isTaskCreator || isStepAssignee)
    const shouldMask = step.requiresApproval && step.status !== 'done' && !canSeeResult

    // 获取所有提交记录（倒序）
    const submissions = await prisma.stepSubmission.findMany({
      where: { stepId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        submitter: {
          select: { id: true, name: true, email: true, agent: { select: { name: true } } }
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

    // 组装结果（shouldMask 时对方看不到 result/summary）
    const history = submissions.map(s => ({
      id: s.id,
      result: shouldMask ? null : s.result,
      summary: shouldMask ? null : s.summary,
      status: s.status,
      createdAt: s.createdAt,
      durationMs: s.durationMs,
      // 🆕 如果提交者是 Agent，优先用 Agent 名字
      submitter: {
        id: s.submitter.id,
        name: (s.submitter as any).agent?.name || s.submitter.name,
        email: s.submitter.email,
      },
      reviewedAt: shouldMask ? null : s.reviewedAt,
      reviewedBy: shouldMask ? null : (s.reviewedBy ? reviewerMap.get(s.reviewedBy) : null),
      reviewNote: shouldMask ? null : s.reviewNote,
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

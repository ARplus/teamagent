import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { validateExamTemplate } from '@/lib/exam-validation'

/**
 * POST /api/academy/courses/[id]/review — 课程审核
 *
 * 创建者：提交审核（reviewStatus → pending）
 *   Body: { action: 'submit' }
 *
 * 管理员（Aurora）：通过/驳回
 *   Body: { action: 'approve' | 'reject', reviewNote?: string }
 *
 * v15.1: 支持 Agent token 认证（Agent 创建的课程可自行提交审核）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 统一认证：Agent token 优先 → Session 兜底
    let user: { id: string; email: string | null } | null = null

    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      user = { id: tokenAuth.user.id, email: tokenAuth.user.email || null }
    }

    if (!user) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true, email: true },
        })
        user = dbUser
      }
    }

    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const course = await prisma.taskTemplate.findUnique({
      where: { id },
      select: { id: true, courseType: true, creatorId: true, reviewStatus: true, examTemplate: true, principleTemplate: true, principleRequired: true },
    })

    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }

    const body = await req.json()
    const { action, reviewNote } = body

    const isAdmin = user.email === 'aurora@arplus.top' || user.email === 'kaikai@arplus.top'
    const isCreator = user.id === course.creatorId

    // 组织 admin：workspace owner 且 workspace.type = 'organization'
    let isOrgAdmin = false
    if (!isAdmin) {
      const courseWs = await prisma.taskTemplate.findUnique({
        where: { id },
        select: { workspaceId: true, workspace: { select: { type: true } } },
      })
      if (courseWs?.workspace?.type === 'organization') {
        const ownerMember = await prisma.workspaceMember.findFirst({
          where: { userId: user.id, workspaceId: courseWs.workspaceId, role: { in: ['owner', 'admin'] } },
        })
        isOrgAdmin = !!ownerMember
      }
    }

    switch (action) {
      case 'submit': {
        // 创建者提交审核
        if (!isCreator && !isAdmin) {
          return NextResponse.json({ error: '只有创建者可以提交审核' }, { status: 403 })
        }

        if (course.reviewStatus === 'pending') {
          return NextResponse.json({ error: '已在审核中' }, { status: 400 })
        }

        // 强制要求：Agent/both 课程必须附带 Principle 草稿（人类课程不需要）
        if (course.courseType !== 'human' && course.principleRequired !== false && !course.principleTemplate?.trim()) {
          return NextResponse.json({ error: '发布课程必须提交 Principle 草稿！这是结业后系统自动下发给学员百宝箱的方法论。' }, { status: 400 })
        }

        // 强制要求：课程必须附带考试
        if (!course.examTemplate) {
          return NextResponse.json({ error: '发布课程必须附带考试！请先设计考试题目。' }, { status: 400 })
        }
        try {
          const examJson = typeof course.examTemplate === 'string' ? course.examTemplate : JSON.stringify(course.examTemplate)
          const exam = JSON.parse(examJson)
          if (!exam.questions || exam.questions.length === 0) {
            return NextResponse.json({ error: '考试必须至少包含 1 道题目' }, { status: 400 })
          }
          // A2A: correctAnswer 格式校验
          const validationErrors = validateExamTemplate(examJson)
          if (validationErrors.length > 0) {
            return NextResponse.json({
              error: '考试模板校验失败，请修正后重新提交审核',
              details: validationErrors
            }, { status: 400 })
          }
        } catch {
          return NextResponse.json({ error: '考试数据格式错误，请重新编辑考试' }, { status: 400 })
        }

        await prisma.taskTemplate.update({
          where: { id },
          data: {
            reviewStatus: 'pending',
            isDraft: false,
          },
        })

        return NextResponse.json({ message: '已提交审核', reviewStatus: 'pending' })
      }

      case 'approve': {
        if (!isAdmin && !isOrgAdmin) {
          return NextResponse.json({ error: '只有管理员或组织管理员可以审核' }, { status: 403 })
        }

        await prisma.taskTemplate.update({
          where: { id },
          data: {
            reviewStatus: 'approved',
            reviewNote: reviewNote || null,
            isPublic: true,
          },
        })

        return NextResponse.json({ message: '审核通过', reviewStatus: 'approved' })
      }

      case 'reject': {
        if (!isAdmin && !isOrgAdmin) {
          return NextResponse.json({ error: '只有管理员或组织管理员可以审核' }, { status: 403 })
        }

        await prisma.taskTemplate.update({
          where: { id },
          data: {
            reviewStatus: 'rejected',
            reviewNote: reviewNote || '未通过审核',
          },
        })

        return NextResponse.json({ message: '已驳回', reviewStatus: 'rejected' })
      }

      case 'withdraw': {
        // 创建者主动下架（已发布 → 回到草稿）
        if (!isCreator && !isAdmin) {
          return NextResponse.json({ error: '只有创建者可以下架课程' }, { status: 403 })
        }

        await prisma.taskTemplate.update({
          where: { id },
          data: {
            reviewStatus: 'none',
            isPublic: false,
            isDraft: true,
          },
        })

        return NextResponse.json({ message: '课程已下架，回到草稿状态', reviewStatus: 'none' })
      }

      default:
        return NextResponse.json({ error: '无效的 action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[Academy/Review] 失败:', error)
    return NextResponse.json({ error: '审核操作失败' }, { status: 500 })
  }
}

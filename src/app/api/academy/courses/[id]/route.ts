import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * PATCH /api/academy/courses/[id] — 更新课程基本信息
 * 支持字段: name, description, courseType, category, tags, price, icon, coverImage,
 *           stepsTemplate (steps数组), principleTemplate
 * 仅课程创建者可操作
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    let userId: string | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) userId = tokenAuth.user.id
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
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const course = await prisma.taskTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, creatorId: true, courseType: true, workspaceId: true },
    })
    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }
    // 权限：创建者 OR 超管邮箱 OR 课程所在 workspace 的 admin/owner
    const isCreator = course.creatorId === userId
    let isAdmin = false
    if (!isCreator) {
      const userInfo = await prisma.user.findUnique({ where: { id: userId! }, select: { email: true } })
      const isSuperAdmin = userInfo?.email === 'aurora@arplus.top' || userInfo?.email === 'kaikai@arplus.top'
      let isWorkspaceAdmin = false
      if (course.workspaceId) {
        const mbr = await prisma.workspaceMember.findFirst({
          where: { userId: userId!, workspaceId: course.workspaceId, role: { in: ['owner', 'admin'] } }
        })
        isWorkspaceAdmin = !!mbr
      } else {
        const anyAdmin = await prisma.workspaceMember.findFirst({
          where: { userId: userId!, role: { in: ['owner', 'admin'] } }
        })
        isWorkspaceAdmin = !!anyAdmin
      }
      isAdmin = isSuperAdmin || isWorkspaceAdmin
    }
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: '只有课程创建者或管理员可以更新课程' }, { status: 403 })
    }

    const body = await req.json()
    const updateData: Record<string, any> = {}

    // 基本信息
    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.courseType !== undefined) updateData.courseType = body.courseType
    if (body.category !== undefined) updateData.category = body.category
    if (body.tags !== undefined) updateData.tags = body.tags
    if (body.price !== undefined) updateData.price = Number(body.price)
    if (body.icon !== undefined) updateData.icon = body.icon
    if (body.coverImage !== undefined) updateData.coverImage = body.coverImage
    if (body.isDraft !== undefined) updateData.isDraft = body.isDraft
    if (body.difficulty !== undefined) updateData.difficulty = body.difficulty
    if (body.school !== undefined) updateData.school = body.school
    if (body.department !== undefined) updateData.department = body.department
    if (body.visibility !== undefined) {
      updateData.visibility = body.visibility
      updateData.isPublic = body.visibility === 'public'
    }

    // stepsTemplate: 接受数组或字符串
    if (body.steps !== undefined || body.stepsTemplate !== undefined) {
      const raw = body.steps ?? body.stepsTemplate
      updateData.stepsTemplate = typeof raw === 'string' ? raw : JSON.stringify(raw)
    }

    // principleTemplate: DB 字段是 String，object 需序列化
    if (body.principleTemplate !== undefined) {
      updateData.principleTemplate = body.principleTemplate === null ? null
        : typeof body.principleTemplate === 'string' ? body.principleTemplate
        : JSON.stringify(body.principleTemplate)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有提供任何可更新字段' }, { status: 400 })
    }

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, courseType: true, isDraft: true },
    })

    console.log(`[Academy/Course/PATCH] ${userId} 更新课程「${course.name}」字段: ${Object.keys(updateData).join(', ')}`)

    return NextResponse.json({
      success: true,
      courseId: updated.id,
      courseName: updated.name,
      updatedFields: Object.keys(updateData),
      message: `「${updated.name}」已更新 ✅`,
    })
  } catch (error) {
    console.error('[Academy/Course/PATCH] 失败:', error)
    return NextResponse.json({ error: '更新课程失败' }, { status: 500 })
  }
}

/**
 * GET /api/academy/courses/[id] — 课程详情
 *
 * 公开预览模式：返回课程基本信息 + 步骤大纲（不含完整内容）
 * 已报名用户：返回完整步骤内容
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const course = await prisma.taskTemplate.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true } } }
        },
        workspace: {
          select: { id: true, name: true }
        },
        _count: {
          select: { enrollments: true }
        },
      },
    })

    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }

    // 检查登录状态 & 是否已报名（支持 Token Auth + Session Auth）
    let enrollment = null
    let userId: string | null = null

    // Token auth（Agent 访问）
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
      enrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_templateId: { userId: tokenAuth.user.id, templateId: id } },
      })
    }

    // Session auth（网页访问）
    if (!userId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
        if (user) {
          userId = user.id
          enrollment = await prisma.courseEnrollment.findUnique({
            where: { userId_templateId: { userId: user.id, templateId: id } },
          })
        }
      }
    }

    // 解析步骤
    let steps: any[] = []
    try {
      steps = JSON.parse(course.stepsTemplate)
    } catch {}

    // 未报名用户只看大纲（标题、描述、assigneeType），不含 videoUrl、详细内容
    const isEnrolled = !!enrollment
    const isCreator = userId === course.creatorId
    // Admin 检查：硬编码超管 OR 该课程所在 workspace 的 admin/owner
    let isAdmin = false
    if (userId) {
      const adminUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
      const isSuperAdmin = adminUser?.email === 'aurora@arplus.top' || adminUser?.email === 'kaikai@arplus.top'
      let isWorkspaceAdmin = false
      if (course.workspaceId) {
        const membership = await prisma.workspaceMember.findFirst({
          where: { userId, workspaceId: course.workspaceId, role: { in: ['owner', 'admin'] } }
        })
        isWorkspaceAdmin = !!membership
      } else {
        // 无 workspace 归属：只要是任意 workspace 的 owner/admin 即视为 admin
        const anyAdmin = await prisma.workspaceMember.findFirst({
          where: { userId, role: { in: ['owner', 'admin'] } }
        })
        isWorkspaceAdmin = !!anyAdmin
      }
      isAdmin = isSuperAdmin || isWorkspaceAdmin
    }

    const stepsForResponse = steps.map((step: any, index: number) => {
      const outline: any = {
        index,
        title: step.title || step.name || `第 ${index + 1} 课`,
        description: step.description || '',
        assigneeType: step.assigneeType || 'agent',
      }

      // 已报名、创建者或 Admin 可以看完整内容
      if (isEnrolled || isCreator || isAdmin) {
        outline.videoUrl = step.videoUrl || null
        outline.htmlUrl = step.htmlUrl || null
        outline.fileUrl = step.fileUrl || null
        outline.fileName = step.fileName || null
        outline.content = step.content || step.prompt || ''
        outline.skillRef = step.skillRef || null
      }

      return outline
    })

    return NextResponse.json({
      id: course.id,
      name: course.name,
      description: course.description,
      icon: course.icon,
      category: course.category,
      tags: course.tags,
      courseType: course.courseType,
      price: course.price,
      coverImage: course.coverImage,
      reviewStatus: course.reviewStatus,
      isPublic: course.isPublic,
      stepsCount: steps.length,
      enrollCount: course._count.enrollments,
      creator: course.creator,
      workspace: course.workspace,
      createdAt: course.createdAt,
      steps: stepsForResponse,
      // principleTemplate（创建者或 Admin 可见 — Agent 需要完整 principleTemplate 字段）
      principleTemplate: (isCreator || isAdmin) ? course.principleTemplate : null,
      // 考试信息（已报名、创建者或 Admin 可见）
      examTemplate: (isEnrolled || isCreator || isAdmin) ? course.examTemplate : null,
      examPassScore: course.examPassScore,
      hasExam: !!course.examTemplate,
      // 用户状态
      isEnrolled,
      isCreator,
      enrollment: enrollment ? {
        id: enrollment.id,
        status: enrollment.status,
        progress: enrollment.progress,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
      } : null,
    })
  } catch (error) {
    console.error('[Academy/Course/GET] 失败:', error)
    return NextResponse.json({ error: '获取课程详情失败' }, { status: 500 })
  }
}

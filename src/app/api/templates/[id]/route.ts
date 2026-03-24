import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { isValidCron, computeNextRun } from '@/lib/cron-utils'
import { validateExamTemplate } from '@/lib/exam-validation'

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

// GET /api/templates/[id] — 获取模版详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.taskTemplate.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        _count: { select: { instances: true } },
      },
    })

    if (!template) {
      return NextResponse.json({ error: '模版不存在' }, { status: 404 })
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error('[Templates/GET/:id] 失败:', error)
    return NextResponse.json({ error: '获取模版详情失败' }, { status: 500 })
  }
}

// PATCH /api/templates/[id] — 更新模版
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.taskTemplate.findUnique({ where: { id } })
    if (!template) {
      return NextResponse.json({ error: '模版不存在' }, { status: 404 })
    }
    // 创建者、工作区 admin、或超级管理员可以编辑
    const isSuperAdmin = ADMIN_EMAILS.includes(auth.user.email || '')
    if (template.creatorId !== auth.userId && !isSuperAdmin) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId, workspaceId: template.workspaceId, role: { in: ['owner', 'admin'] } },
      })
      if (!membership) {
        return NextResponse.json({ error: '只有创建者或管理员可以编辑模版' }, { status: 403 })
      }
    }

    const body = await req.json()
    const updateData: any = {}

    // 可更新字段
    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.icon !== undefined) updateData.icon = body.icon
    if (body.category !== undefined) updateData.category = body.category
    if (body.tags !== undefined) {
      updateData.tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : body.tags
    }
    if (body.variables !== undefined) {
      updateData.variables = JSON.stringify(body.variables)
    }
    if (body.stepsTemplate !== undefined) {
      if (!Array.isArray(body.stepsTemplate) || body.stepsTemplate.length === 0) {
        return NextResponse.json({ error: '步骤模板不能为空' }, { status: 400 })
      }
      updateData.stepsTemplate = JSON.stringify(body.stepsTemplate)
    }
    if (body.executionProtocol !== undefined) updateData.executionProtocol = body.executionProtocol || null
    if (body.defaultMode !== undefined) updateData.defaultMode = body.defaultMode
    if (body.defaultPriority !== undefined) updateData.defaultPriority = body.defaultPriority
    if (body.isPublic !== undefined) updateData.isPublic = body.isPublic
    if (body.visibility !== undefined && ['public','workspace','private'].includes(body.visibility)) {
      updateData.visibility = body.visibility
      // 保持 isPublic 与 visibility 同步（向后兼容）
      updateData.isPublic = body.visibility === 'public'
    }
    if (body.isDraft !== undefined) {
      updateData.isDraft = body.isDraft
      if (body.isDraft) {
        // 收回草稿：强制 visibility=private，防止出现 public+draft 的不一致状态
        updateData.visibility = 'private'
        updateData.isPublic = false
      } else if (body.visibility === undefined && body.isPublic === undefined) {
        // 发布时：草稿 → workspace（不强制 public，保留用户设置）
        const currentVisibility = (template as any).visibility || 'workspace'
        updateData.visibility = currentVisibility === 'private' ? 'workspace' : currentVisibility
        updateData.isPublic = updateData.visibility === 'public'
      }
    }
    if (body.isEnabled !== undefined) updateData.isEnabled = body.isEnabled
    if (body.requiresApprovalGate !== undefined) updateData.requiresApprovalGate = !!body.requiresApprovalGate

    // 课程字段
    if (body.price !== undefined) updateData.price = body.price === null || body.price === '' ? null : Number(body.price)
    if (body.courseType !== undefined) updateData.courseType = body.courseType || null
    if (body.coverImage !== undefined) updateData.coverImage = body.coverImage || null
    if (body.school !== undefined) updateData.school = body.school || null
    if (body.department !== undefined) updateData.department = body.department || null
    if (body.difficulty !== undefined) updateData.difficulty = body.difficulty || null

    // 考试字段 + correctAnswer 格式校验
    if (body.examTemplate !== undefined) {
      if (body.examTemplate) {
        const examJson = typeof body.examTemplate === 'string' ? body.examTemplate : JSON.stringify(body.examTemplate)
        // A2A: 校验 correctAnswer 格式
        const validationErrors = validateExamTemplate(examJson)
        if (validationErrors.length > 0) {
          return NextResponse.json({
            error: '考试模板校验失败',
            details: validationErrors
          }, { status: 400 })
        }
        updateData.examTemplate = examJson
      } else {
        updateData.examTemplate = null
      }
    }
    if (body.examPassScore !== undefined) updateData.examPassScore = Number(body.examPassScore) || 60
    // Principle 百宝箱
    if (body.principleTemplate !== undefined) updateData.principleTemplate = body.principleTemplate === null ? null
      : typeof body.principleTemplate === 'string' ? body.principleTemplate
      : JSON.stringify(body.principleTemplate)

    // 调度更新
    if (body.schedule !== undefined) {
      if (body.schedule === null || body.schedule === '') {
        updateData.schedule = null
        updateData.scheduleEnabled = false
        updateData.nextRunAt = null
      } else {
        if (!isValidCron(body.schedule)) {
          return NextResponse.json({ error: '无效的 cron 表达式' }, { status: 400 })
        }
        updateData.schedule = body.schedule
        updateData.scheduleEnabled = true
        updateData.nextRunAt = computeNextRun(body.schedule, body.timezone || template.timezone)
      }
    }
    if (body.scheduleEnabled !== undefined) {
      updateData.scheduleEnabled = body.scheduleEnabled
      if (!body.scheduleEnabled) {
        updateData.nextRunAt = null
      } else if (template.schedule) {
        updateData.nextRunAt = computeNextRun(template.schedule, template.timezone)
      }
    }

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data: updateData,
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Templates/PATCH/:id] 失败:', error)
    return NextResponse.json({ error: '更新模版失败' }, { status: 500 })
  }
}

// DELETE /api/templates/[id] — 删除模版
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.taskTemplate.findUnique({ where: { id } })
    if (!template) {
      return NextResponse.json({ error: '模版不存在' }, { status: 404 })
    }

    // 创建者、工作区 admin、或超级管理员可删除
    const isSuperAdmin = ADMIN_EMAILS.includes(auth.user.email || '')
    if (template.creatorId !== auth.userId && !isSuperAdmin) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          userId: auth.userId,
          workspaceId: template.workspaceId,
          role: { in: ['owner', 'admin'] },
        },
      })
      if (!membership) {
        return NextResponse.json({ error: '无权删除此模版' }, { status: 403 })
      }
    }

    await prisma.taskTemplate.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Templates/DELETE/:id] 失败:', error)
    return NextResponse.json({ error: '删除模版失败' }, { status: 500 })
  }
}

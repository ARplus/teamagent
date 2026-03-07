import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { isValidCron, computeNextRun } from '@/lib/cron-utils'

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
    if (template.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有创建者可以编辑模版' }, { status: 403 })
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
    if (body.defaultMode !== undefined) updateData.defaultMode = body.defaultMode
    if (body.defaultPriority !== undefined) updateData.defaultPriority = body.defaultPriority
    if (body.isPublic !== undefined) updateData.isPublic = body.isPublic
    if (body.isEnabled !== undefined) updateData.isEnabled = body.isEnabled

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

    // 创建者或工作区 admin 可删除
    if (template.creatorId !== auth.userId) {
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

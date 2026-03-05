import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { isValidCron, computeNextRun } from '@/lib/cron-utils'

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

// GET /api/scheduled/:id — 模板详情 + 执行历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params

    const template = await prisma.scheduledTemplate.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        instances: {
          select: {
            id: true,
            title: true,
            status: true,
            instanceNumber: true,
            createdAt: true,
            updatedAt: true,
            steps: {
              select: { id: true, status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 })
    }

    // 检查工作区权限
    const isMember = await prisma.workspaceMember.findFirst({
      where: { userId: auth.userId, workspaceId: template.workspaceId },
    })
    if (!isMember) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error('[Scheduled/GET/:id] 失败:', error)
    return NextResponse.json({ error: '获取模板详情失败' }, { status: 500 })
  }
}

// PATCH /api/scheduled/:id — 更新模板
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.scheduledTemplate.findUnique({ where: { id } })

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 })
    }
    if (template.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有创建者可以修改' }, { status: 403 })
    }

    const body = await req.json()
    const updateData: any = {}

    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.approvalMode !== undefined) {
      if (!['every', 'on_error', 'auto'].includes(body.approvalMode)) {
        return NextResponse.json({ error: '无效的审批模式' }, { status: 400 })
      }
      updateData.approvalMode = body.approvalMode
    }
    if (body.deliveryBoard !== undefined) updateData.deliveryBoard = body.deliveryBoard
    if (body.deliveryChat !== undefined) updateData.deliveryChat = body.deliveryChat

    // 更新 schedule 时重算 nextRunAt
    if (body.schedule !== undefined) {
      if (!isValidCron(body.schedule)) {
        return NextResponse.json({ error: '无效的 cron 表达式' }, { status: 400 })
      }
      updateData.schedule = body.schedule
      const tz = body.timezone || template.timezone
      updateData.nextRunAt = template.enabled ? computeNextRun(body.schedule, tz) : null
    }
    if (body.timezone !== undefined) {
      updateData.timezone = body.timezone
      const sched = body.schedule || template.schedule
      updateData.nextRunAt = template.enabled ? computeNextRun(sched, body.timezone) : null
    }

    const updated = await prisma.scheduledTemplate.update({
      where: { id },
      data: updateData,
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Scheduled/PATCH/:id] 失败:', error)
    return NextResponse.json({ error: '更新模板失败' }, { status: 500 })
  }
}

// DELETE /api/scheduled/:id — 删除模板
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.scheduledTemplate.findUnique({ where: { id } })

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 })
    }
    if (template.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有创建者可以删除' }, { status: 403 })
    }

    // 先断开实例任务的关联（不删除任务本身）
    await prisma.task.updateMany({
      where: { templateId: id },
      data: { templateId: null },
    })

    await prisma.scheduledTemplate.delete({ where: { id } })

    console.log(`[Scheduled/DELETE] 删除模板: "${template.title}"`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Scheduled/DELETE/:id] 失败:', error)
    return NextResponse.json({ error: '删除模板失败' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { isValidCron, computeNextRun } from '@/lib/cron-utils'
import { snapshotStepsFromTask } from '@/lib/scheduled-executor'

// 统一认证（复用 tasks/route.ts 模式）
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

// GET /api/scheduled — 列出当前工作区的定时模板
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    let workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId, role: 'owner' },
        select: { workspaceId: true },
      })
      workspaceId = membership?.workspaceId || null
      if (!workspaceId) {
        const any = await prisma.workspaceMember.findFirst({
          where: { userId: auth.userId },
          select: { workspaceId: true },
        })
        workspaceId = any?.workspaceId || null
      }
    }

    if (!workspaceId) {
      return NextResponse.json({ error: '未找到工作区' }, { status: 400 })
    }

    const templates = await prisma.taskTemplate.findMany({
      where: { workspaceId, schedule: { not: null } },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        _count: { select: { instances: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(templates)
  } catch (error) {
    console.error('[Scheduled/GET] 失败:', error)
    return NextResponse.json({ error: '获取定时模板失败' }, { status: 500 })
  }
}

// POST /api/scheduled — 创建定时模板
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const body = await req.json()
    const {
      sourceTaskId,
      title,
      description,
      schedule,
      timezone = 'Asia/Shanghai',
      approvalMode = 'every',
      deliveryBoard = true,
      deliveryChat = false,
      workspaceId: reqWorkspaceId,
    } = body

    // 校验 cron
    if (!schedule || !isValidCron(schedule)) {
      return NextResponse.json({ error: '无效的 cron 表达式' }, { status: 400 })
    }

    // 校验审批模式
    if (!['every', 'on_error', 'auto'].includes(approvalMode)) {
      return NextResponse.json({ error: '无效的审批模式' }, { status: 400 })
    }

    // 确定 workspaceId
    let workspaceId = reqWorkspaceId
    let stepsTemplate = '[]'
    let finalTitle = title

    if (sourceTaskId) {
      // 从已完成任务创建
      const sourceTask = await prisma.task.findUnique({
        where: { id: sourceTaskId },
        select: { id: true, title: true, description: true, workspaceId: true, creatorId: true, status: true },
      })
      if (!sourceTask) {
        return NextResponse.json({ error: '源任务不存在' }, { status: 404 })
      }
      if (sourceTask.status !== 'done') {
        return NextResponse.json({ error: '只能从已完成的任务创建定时模板' }, { status: 400 })
      }
      workspaceId = workspaceId || sourceTask.workspaceId
      finalTitle = finalTitle || sourceTask.title
      stepsTemplate = await snapshotStepsFromTask(sourceTaskId)
    } else {
      // 直接创建
      if (!finalTitle) {
        return NextResponse.json({ error: '请填写任务标题' }, { status: 400 })
      }
      // 无 sourceTask 时，首次执行会走 AI 拆解
    }

    if (!workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId, role: 'owner' },
        select: { workspaceId: true },
      })
      workspaceId = membership?.workspaceId
    }
    if (!workspaceId) {
      return NextResponse.json({ error: '未找到工作区' }, { status: 400 })
    }

    // 检查工作区成员
    const isMember = await prisma.workspaceMember.findFirst({
      where: { userId: auth.userId, workspaceId },
    })
    if (!isMember) {
      return NextResponse.json({ error: '你不是该工作区成员' }, { status: 403 })
    }

    // 检查上限（每工作区 20 个定时任务，不含课程/普通模版）
    const existingCount = await prisma.taskTemplate.count({
      where: { workspaceId, schedule: { not: null } },
    })
    if (existingCount >= 20) {
      return NextResponse.json({ error: '每个工作区最多 20 个定时任务' }, { status: 400 })
    }

    // 计算下次执行时间
    const nextRunAt = computeNextRun(schedule, timezone)

    const template = await prisma.taskTemplate.create({
      data: {
        sourceTaskId: sourceTaskId || null,
        name: finalTitle,
        description: description || null,
        workspaceId,
        creatorId: auth.userId,
        stepsTemplate,
        schedule,
        timezone,
        scheduleEnabled: true,
        approvalMode,
        deliveryBoard,
        deliveryChat,
        nextRunAt,
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
      },
    })

    console.log(`[Scheduled/POST] 创建模板: "${template.name}" (cron: ${schedule})`)

    return NextResponse.json(template)
  } catch (error) {
    console.error('[Scheduled/POST] 失败:', error)
    return NextResponse.json({ error: '创建定时模板失败' }, { status: 500 })
  }
}

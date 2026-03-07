import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { isValidCron, computeNextRun } from '@/lib/cron-utils'

// 统一认证（返回 source 区分 Agent vs 人类）
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user, source: 'agent' as const }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user, source: 'human' as const }
  }
  return null
}

// GET /api/templates — 列出模版（支持搜索/筛选）
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    let workspaceId = searchParams.get('workspaceId')
    const category = searchParams.get('category')
    const skill = searchParams.get('skill')
    const q = searchParams.get('q')

    // 默认取用户的工作区
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

    // 构建查询条件
    const where: any = {
      isEnabled: true,
      OR: [
        { workspaceId },         // 本工作区的模版
        { isPublic: true },      // 公开模版
      ],
    }

    if (category && category !== 'all') {
      where.category = category
    }

    const templates = await prisma.taskTemplate.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        _count: { select: { instances: true } },
      },
      orderBy: [{ useCount: 'desc' }, { createdAt: 'desc' }],
    })

    // 应用文本搜索过滤（q 参数）
    let filtered = templates
    if (q) {
      const lower = q.toLowerCase()
      filtered = templates.filter(t =>
        t.name.toLowerCase().includes(lower) ||
        t.description?.toLowerCase().includes(lower) ||
        t.tags?.toLowerCase().includes(lower)
      )
    }

    // 应用 skill 过滤
    if (skill) {
      filtered = filtered.filter(t => {
        try {
          const steps = JSON.parse(t.stepsTemplate) as any[]
          return steps.some(s => s.skillRef === skill || s.skills?.includes(skill))
        } catch { return false }
      })
    }

    return NextResponse.json(filtered)
  } catch (error) {
    console.error('[Templates/GET] 失败:', error)
    return NextResponse.json({ error: '获取模版列表失败' }, { status: 500 })
  }
}

// POST /api/templates — 创建模版（仅 Agent 可用）
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // 只有 Agent（API Token 认证）可以创建模版
    if (auth.source !== 'agent') {
      return NextResponse.json({ error: '模版只能由 Agent 创建，请告诉你的 Agent 来创建' }, { status: 403 })
    }

    const body = await req.json()
    const {
      name,
      description,
      icon,
      category = 'general',
      tags,
      variables = [],
      stepsTemplate,
      defaultMode = 'solo',
      defaultPriority = 'medium',
      schedule,
      timezone = 'Asia/Shanghai',
      sourceType = 'manual',
      sourceTaskId,
      isPublic = false,
      workspaceId: reqWorkspaceId,
      // 兼容旧字段
      approvalMode = 'every',
    } = body

    // 校验必填
    if (!name) {
      return NextResponse.json({ error: '请填写模版名称' }, { status: 400 })
    }
    if (!stepsTemplate || !Array.isArray(stepsTemplate) || stepsTemplate.length === 0) {
      return NextResponse.json({ error: '步骤模板不能为空' }, { status: 400 })
    }

    // 确定 workspaceId
    let workspaceId = reqWorkspaceId
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

    // 检查上限（每工作区 50 个模版）
    const existingCount = await prisma.taskTemplate.count({
      where: { workspaceId },
    })
    if (existingCount >= 50) {
      return NextResponse.json({ error: '每个工作区最多 50 个模版' }, { status: 400 })
    }

    // 校验 schedule（如果提供）
    let nextRunAt: Date | null = null
    if (schedule) {
      if (!isValidCron(schedule)) {
        return NextResponse.json({ error: '无效的 cron 表达式' }, { status: 400 })
      }
      nextRunAt = computeNextRun(schedule, timezone)
    }

    const template = await prisma.taskTemplate.create({
      data: {
        name,
        description: description || null,
        icon: icon || null,
        category,
        tags: Array.isArray(tags) ? JSON.stringify(tags) : (tags || null),
        variables: JSON.stringify(variables),
        stepsTemplate: JSON.stringify(stepsTemplate),
        defaultMode,
        defaultPriority,
        schedule: schedule || null,
        timezone,
        scheduleEnabled: !!schedule,
        approvalMode,
        isPublic,
        isEnabled: true,
        sourceTaskId: sourceTaskId || null,
        sourceType,
        workspaceId,
        creatorId: auth.userId,
        nextRunAt,
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
      },
    })

    console.log(`[Templates/POST] 创建模版: "${template.name}" (${sourceType})`)

    return NextResponse.json(template)
  } catch (error) {
    console.error('[Templates/POST] 失败:', error)
    return NextResponse.json({ error: '创建模版失败' }, { status: 500 })
  }
}

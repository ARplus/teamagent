import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { isValidCron, computeNextRun } from '@/lib/cron-utils'
import { validateExamTemplate } from '@/lib/exam-validation'

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

    // 取用户所在的所有工作区 ID（workspace-scoped 模版对所有成员可见）
    const allMemberships = await prisma.workspaceMember.findMany({
      where: { userId: auth.userId },
      select: { workspaceId: true, role: true },
    })
    const memberWorkspaceIds = allMemberships.map(m => m.workspaceId)

    // 默认 workspaceId：优先 owner 的工作区，用于 admin 草稿可见判断
    if (!workspaceId) {
      workspaceId =
        allMemberships.find(m => m.role === 'owner')?.workspaceId ||
        allMemberships[0]?.workspaceId ||
        null
    }

    // 无 workspace 成员资格（如新注册 Agent）→ 只返回公开模版，不报错

    // 查询用户在 workspaceId 的角色（admin/owner 可以看到 draft）
    const isAdmin = allMemberships.some(
      m => m.workspaceId === workspaceId && (m.role === 'owner' || m.role === 'admin')
    )

    // 构建查询条件（visibility 三级过滤）
    const where: any = {
      isEnabled: true,
      OR: [
        // 公开模版：所有人可见
        { visibility: 'public', isDraft: false },
        // 工作区模版：用户所在的任意工作区均可见（App Store 原则：加入了工作区就能看到模版）
        { workspaceId: { in: memberWorkspaceIds }, visibility: 'workspace', isDraft: false },
        // 私有模版：仅创建者可见
        { creatorId: auth.userId, visibility: 'private', isDraft: false },
        // 草稿：创建者可见
        { creatorId: auth.userId, isDraft: true },
        // admin/owner 可见本工作区所有草稿
        ...(isAdmin ? [{ workspaceId, isDraft: true }] : []),
        // 兼容旧数据：isPublic=true 但 visibility 未迁移的
        { isPublic: true, isDraft: false },
      ],
    }

    if (category && category !== 'all') {
      where.category = category
    }

    // 排除课程（courseType 不为空的是学院课程，不在模版库显示）
    if (!searchParams.get('includeCourses')) {
      where.courseType = null
    }

    const templates = await prisma.taskTemplate.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, avatar: true, agent: { select: { name: true } } } },
        _count: { select: { instances: true } },
      },
      orderBy: [{ isDraft: 'asc' }, { useCount: 'desc' }, { createdAt: 'desc' }],
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
      isPublic = true,
      isDraft = false,
      visibility: visibilityInput,  // 'public' | 'workspace' | 'private'
      workspaceId: reqWorkspaceId,
      executionProtocol,
      // 兼容旧字段
      approvalMode = 'every',
      // 课程字段
      courseType,
      price,
      coverImage,
      difficulty,
      school,
      department,
      // 考试字段
      examTemplate,
      examPassScore,
      // Principle 百宝箱
      principleTemplate,
    } = body

    // 课程或普通模板均可由人类/Agent 创建

    // 校验必填
    if (!name) {
      return NextResponse.json({ error: '请填写模版名称' }, { status: 400 })
    }
    // 兼容 string 传参（api CLI 用 JSON 文件发送时会传字符串）
    const stepsArr = typeof stepsTemplate === 'string'
      ? (() => { try { return JSON.parse(stepsTemplate) } catch { return null } })()
      : stepsTemplate
    if (!stepsArr || !Array.isArray(stepsArr) || stepsArr.length === 0) {
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
    // fallback: 非 owner 也能找到工作区
    if (!workspaceId) {
      const anyMembership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId },
        select: { workspaceId: true },
        orderBy: { joinedAt: 'asc' },
      })
      workspaceId = anyMembership?.workspaceId || null
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

    // v15: correctAnswer 格式校验（创建时闭环）
    if (examTemplate) {
      const examJson = typeof examTemplate === 'string' ? examTemplate : JSON.stringify(examTemplate)
      const validationErrors = validateExamTemplate(examJson)
      if (validationErrors.length > 0) {
        return NextResponse.json({
          error: '考试模板校验失败',
          details: validationErrors,
        }, { status: 400 })
      }
    }

    // Bug3 防御：确保不会 double-stringify（前端可能传 string 或 object）
    const safeStringify = (val: any): string => {
      if (typeof val === 'string') {
        // 已经是 string，验证是否合法 JSON
        try { JSON.parse(val); return val } catch { /* fallthrough */ }
      }
      return JSON.stringify(val)
    }

    const template = await prisma.taskTemplate.create({
      data: {
        name,
        description: description || null,
        icon: icon || null,
        category,
        tags: Array.isArray(tags) ? JSON.stringify(tags) : (tags || null),
        variables: safeStringify(variables),
        stepsTemplate: safeStringify(stepsTemplate),
        defaultMode,
        defaultPriority,
        schedule: schedule || null,
        timezone,
        scheduleEnabled: !!schedule,
        approvalMode,
        isPublic: isDraft ? false : (visibilityInput === 'public' || isPublic),
        visibility: isDraft ? 'private' : (['public','workspace','private'].includes(visibilityInput) ? visibilityInput : (isPublic ? 'public' : 'workspace')),
        isDraft,
        isEnabled: true,
        sourceTaskId: sourceTaskId || null,
        executionProtocol: executionProtocol || null,
        sourceType,
        workspaceId,
        creatorId: auth.userId,
        nextRunAt,
        // 课程字段
        ...(courseType && { courseType }),
        ...(price !== undefined && price !== null && price !== '' && { price: Number(price) }),
        ...(coverImage && { coverImage }),
        ...(difficulty !== undefined && { difficulty: difficulty || null }),
        ...(school !== undefined && { school: school || null }),
        ...(department !== undefined && { department: department || null }),
        // 考试字段（v15 闭环）
        ...(examTemplate && {
          examTemplate: typeof examTemplate === 'string' ? examTemplate : JSON.stringify(examTemplate),
        }),
        ...(examPassScore !== undefined && examPassScore !== null && { examPassScore: Number(examPassScore) }),
        // Principle 百宝箱（DB 字段是 String，object 需序列化）
        ...(principleTemplate !== undefined && principleTemplate !== null && {
          principleTemplate: typeof principleTemplate === 'string' ? principleTemplate : JSON.stringify(principleTemplate),
        }),
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true, agent: { select: { name: true } } } },
      },
    })

    console.log(`[Templates/POST] 创建模版: "${template.name}" (${sourceType})`)

    return NextResponse.json(template)
  } catch (error) {
    console.error('[Templates/POST] 失败:', error)
    return NextResponse.json({ error: '创建模版失败' }, { status: 500 })
  }
}

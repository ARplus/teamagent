import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

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

// POST /api/tasks/[id]/save-as-template — 从已完成任务保存为模版
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: taskId } = await params

    // 1. 加载任务和步骤
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        steps: {
          where: { stepType: { not: 'decompose' } },
          include: {
            assignees: {
              select: { userId: true, assigneeType: true, isPrimary: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }
    if (task.status !== 'done') {
      return NextResponse.json({ error: '只能从已完成的任务保存模版' }, { status: 400 })
    }
    if (task.steps.length === 0) {
      return NextResponse.json({ error: '任务没有步骤，无法保存为模版' }, { status: 400 })
    }

    const body = await req.json()
    const {
      name,
      description,
      icon,
      category = 'general',
      tags,
      variables = [],
    } = body

    if (!name) {
      return NextResponse.json({ error: '请填写模版名称' }, { status: 400 })
    }

    // 2. 从步骤快照生成 stepsTemplate
    const stepsTemplate = task.steps.map(s => ({
      order: s.order,
      title: s.title,
      description: s.description,
      stepType: s.stepType,
      assigneeId: s.assigneeId,
      assigneeRole: s.assignees?.[0]?.assigneeType || 'agent',
      requiresApproval: s.requiresApproval,
      parallelGroup: s.parallelGroup,
      inputs: s.inputs ? JSON.parse(s.inputs) : null,
      outputs: s.outputs ? JSON.parse(s.outputs) : null,
      skills: s.skills ? JSON.parse(s.skills) : null,
      skillRef: null,
      promptTemplate: null,
    }))

    // 3. 创建模版
    const template = await prisma.taskTemplate.create({
      data: {
        name,
        description: description || task.description,
        icon: icon || null,
        category,
        tags: Array.isArray(tags) ? JSON.stringify(tags) : (tags || null),
        variables: JSON.stringify(variables),
        stepsTemplate: JSON.stringify(stepsTemplate),
        defaultMode: task.mode,
        defaultPriority: task.priority,
        sourceTaskId: taskId,
        sourceType: 'from-task',
        workspaceId: task.workspaceId,
        creatorId: auth.userId,
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
      },
    })

    console.log(`[SaveAsTemplate] ✅ Task "${task.title}" → Template "${name}"`)

    return NextResponse.json({
      templateId: template.id,
      name: template.name,
      stepsCount: stepsTemplate.length,
      message: '模版保存成功',
    })
  } catch (error) {
    console.error('[SaveAsTemplate] 失败:', error)
    return NextResponse.json({ error: '保存模版失败' }, { status: 500 })
  }
}

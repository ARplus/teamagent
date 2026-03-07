import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { createNotification } from '@/lib/notifications'
import { getStartableSteps, activateAndNotifySteps } from '@/lib/step-scheduling'
import {
  getBuiltinVariables,
  validateVariables,
  instantiateSteps,
  type VariableDefinition,
  type StepTemplate,
} from '@/lib/template-engine'

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

// POST /api/templates/[id]/run — 从模版创建任务并激活
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params

    // 1. 加载模版
    const template = await prisma.taskTemplate.findUnique({
      where: { id },
      include: {
        workspace: { select: { name: true } },
      },
    })
    if (!template) {
      return NextResponse.json({ error: '模版不存在' }, { status: 404 })
    }
    if (!template.isEnabled) {
      return NextResponse.json({ error: '该模版已归档' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const {
      variables: userVariables = {},
      overrides = {},
    } = body

    // 2. 解析模版定义
    let variableDefs: VariableDefinition[] = []
    let stepsTemplate: StepTemplate[] = []
    try {
      variableDefs = JSON.parse(template.variables)
    } catch {
      variableDefs = []
    }
    try {
      stepsTemplate = JSON.parse(template.stepsTemplate)
    } catch {
      return NextResponse.json({ error: '步骤模板格式错误' }, { status: 500 })
    }
    if (!Array.isArray(stepsTemplate) || stepsTemplate.length === 0) {
      return NextResponse.json({ error: '模版步骤为空' }, { status: 500 })
    }

    // 3. 校验并合并变量
    const builtins = getBuiltinVariables(auth.user.name || undefined, template.workspace?.name)
    const { valid, errors, resolved } = validateVariables(variableDefs, userVariables)
    if (!valid) {
      return NextResponse.json({ error: '变量校验失败', details: errors }, { status: 400 })
    }
    // 合并：用户变量 > 默认值 > 内置变量
    const allVariables = { ...builtins, ...resolved }

    // 4. 实例化步骤
    const steps = instantiateSteps(stepsTemplate, allVariables)

    // 5. 生成任务标题
    const instanceNumber = template.useCount + 1
    const titleBase = template.name
    const dateStr = allVariables.TODAY || new Date().toLocaleDateString('zh-CN')
    const taskTitle = `${titleBase} (#${instanceNumber} ${dateStr})`

    const mode = overrides.mode || template.defaultMode
    const priority = overrides.priority || template.defaultPriority

    // 6. 创建 Task
    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        description: template.description,
        status: 'todo',
        priority,
        mode,
        creatorId: auth.userId,
        workspaceId: template.workspaceId,
        templateId: template.id,
        instanceNumber,
      },
    })

    // 7. 创建 TaskSteps
    const createdSteps: any[] = []
    for (const s of steps) {
      const step = await prisma.taskStep.create({
        data: {
          ...s,
          taskId: task.id,
          status: 'pending',
          agentStatus: s.assigneeId ? 'pending' : null,
        },
      })

      // 创建 StepAssignee 记录
      if (s.assigneeId) {
        const assigneeAgent = await prisma.agent.findUnique({
          where: { userId: s.assigneeId },
          select: { id: true },
        })
        await prisma.stepAssignee.create({
          data: {
            stepId: step.id,
            userId: s.assigneeId,
            isPrimary: true,
            assigneeType: assigneeAgent ? 'agent' : 'human',
          },
        }).catch(() => {})
      }

      createdSteps.push(step)
    }

    // 8. 激活可执行的步骤
    if (createdSteps.length > 0) {
      const startable = getStartableSteps(createdSteps)
      await activateAndNotifySteps(task.id, startable)
    }

    // 9. 更新模版统计
    await prisma.taskTemplate.update({
      where: { id },
      data: {
        useCount: instanceNumber,
        lastUsedAt: new Date(),
      },
    })

    // 10. 通知
    sendToUser(auth.userId, {
      type: 'task:created',
      taskId: task.id,
      title: task.title,
    })
    await createNotification({
      userId: auth.userId,
      type: 'task_assigned',
      title: '📋 模版任务已创建',
      content: `从模版「${template.name}」创建任务，共 ${createdSteps.length} 个步骤`,
      taskId: task.id,
    })

    console.log(`[Templates/Run] ✅ "${template.name}" → Task ${task.id} (${createdSteps.length} steps)`)

    return NextResponse.json({
      taskId: task.id,
      title: task.title,
      stepsCreated: createdSteps.length,
      message: `从模版创建成功，已通知 Agent`,
    })
  } catch (error) {
    console.error('[Templates/Run] 失败:', error)
    return NextResponse.json({ error: '执行模版失败' }, { status: 500 })
  }
}

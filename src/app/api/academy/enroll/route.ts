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

// 统一认证（返回 agentId 用于标记 enrolledByAgentId）
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user, agentId: (tokenAuth.user as any).agent?.id || null }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user, agentId: null }
  }
  return null
}


/**
 * POST /api/academy/enroll — 报名/购买课程
 *
 * Body: { templateId: string }
 *
 * 逻辑：
 * 1. 检查课程存在且已审核通过
 * 2. 检查是否已报名（幂等）
 * 3. 免费课直接报名；付费课扣 Token
 * 4. 创建 CourseEnrollment 记录
 * 5. agent/both 课程：自动创建学习任务（含 pre_check）
 * 6. 通知课程创建者有新学员
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body = await req.json()
    const { templateId } = body

    if (!templateId) {
      return NextResponse.json({ error: '缺少 templateId' }, { status: 400 })
    }

    // 1. 查课程（含发布者 Agent 信息，用于 pre_check）
    const course = await prisma.taskTemplate.findUnique({
      where: { id: templateId },
      include: {
        creator: {
          select: {
            id: true, name: true, nickname: true,
            agent: { select: { id: true, name: true, parentAgentId: true } }
          }
        }
      }
    })

    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }

    if (course.reviewStatus !== 'approved') {
      return NextResponse.json({ error: '课程未通过审核' }, { status: 400 })
    }

    // 2. 检查是否已报名（幂等）
    const existing = await prisma.courseEnrollment.findUnique({
      where: { userId_templateId: { userId: auth.userId, templateId } },
    })

    if (existing) {
      // 如果之前通过网页报名(enrolledByAgentId=null)，现在用 Agent token 再次报名，补上 agentId
      if (!existing.enrolledByAgentId && auth.agentId) {
        const updated = await prisma.courseEnrollment.update({
          where: { id: existing.id },
          data: { enrolledByAgentId: auth.agentId },
        })
        console.log(`[Academy/Enroll] 补写 enrolledByAgentId=${auth.agentId} → enrollment ${existing.id}`)
        return NextResponse.json({
          message: '已报名（已关联 Agent）',
          enrollment: updated,
        })
      }
      return NextResponse.json({
        message: '已报名',
        enrollment: existing,
      })
    }

    // 3. 付费课扣 Token
    const price = course.price || 0
    let paidTokens = 0

    if (price > 0) {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { creditBalance: true },
      })

      if (!user || user.creditBalance < price) {
        return NextResponse.json({
          error: `Token 不足，需要 ${price} Token，当前余额 ${user?.creditBalance || 0}`,
        }, { status: 400 })
      }

      await prisma.user.update({
        where: { id: auth.userId },
        data: { creditBalance: { decrement: price } },
      })
      paidTokens = price
    }

    // 4. 创建报名记录
    const enrollment = await prisma.courseEnrollment.create({
      data: {
        userId: auth.userId,
        templateId,
        status: 'enrolled',
        progress: 0,
        paidTokens,
        ...(auth.agentId ? { enrolledByAgentId: auth.agentId } : {}),
      },
    })

    // 5. 增加使用次数
    await prisma.taskTemplate.update({
      where: { id: templateId },
      data: { useCount: { increment: 1 } },
    })

    // 6. 所有课程类型都创建学习任务（学习不分人机）
    let createdTaskId: string | null = null
    if (course.courseType) {
      try {
        // 解析步骤模版
        let stepsTemplate: StepTemplate[] = []
        let variableDefs: VariableDefinition[] = []
        try {
          stepsTemplate = JSON.parse(course.stepsTemplate || '[]')
        } catch {
          console.warn('[Academy/Enroll] stepsTemplate parse failed')
        }
        try {
          variableDefs = JSON.parse(course.variables || '[]')
        } catch {
          console.warn('[Academy/Enroll] variables parse failed')
        }

        if (Array.isArray(stepsTemplate) && stepsTemplate.length > 0) {
          // 构建变量（内置变量 + 课程默认值）
          const builtins = getBuiltinVariables(auth.user?.name || undefined, undefined)
          const { resolved } = validateVariables(variableDefs, {})
          const allVariables = { ...builtins, ...resolved }

          // 实例化步骤（课程不注入硬指令，课程模版自带 promptTemplate 就够）
          const steps = instantiateSteps(stepsTemplate, allVariables)

          // 创建任务
          const instanceNumber = course.useCount + 1
          const dateStr = allVariables.TODAY || new Date().toLocaleDateString('zh-CN')
          const taskTitle = `${course.name} (#${instanceNumber} ${dateStr})`

          const task = await prisma.task.create({
            data: {
              title: taskTitle,
              description: course.description,
              status: 'todo',
              priority: course.defaultPriority || 'medium',
              mode: course.defaultMode || 'solo',
              creatorId: auth.userId,
              workspaceId: course.workspaceId,
              templateId: course.id,
              instanceNumber,
              decomposeStatus: 'done',
              decomposeEngine: 'template',
            },
          })
          createdTaskId = task.id

          // ——— PRE_CHECK 审批门控（暂时注释，等人机互动课程场景成熟再启用）———
          // 设计：发布者 Agent 收到新学员报名通知 → 写学习计划 → 学员确认后课程正式开始
          // 代码备份见 git history（2026-03-22 之前版本）
          // ————————————————————————————————————————————————

          // 学员 Agent 是否存在（用于确定步骤 assigneeType）
          const learnerAgent = await prisma.agent.findUnique({
            where: { userId: auth.userId },
            select: { id: true },
          })

          // 创建课程步骤（全部分配给学员）
          const createdSteps: any[] = []
          for (let i = 0; i < steps.length; i++) {
            const s = steps[i]
            const step = await prisma.taskStep.create({
              data: {
                title: s.title,
                description: s.description,
                order: s.order,
                stepType: s.stepType,
                assigneeId: auth.userId,
                requiresApproval: false,  // 课程步骤默认自动流转，Watch 自动接管，无需人工逐步审批
                parallelGroup: s.parallelGroup,
                inputs: s.inputs,
                outputs: s.outputs,
                skills: s.skills,
                taskId: task.id,
                status: 'pending',
                agentStatus: auth.userId ? 'pending' : null,
                needsHumanInput: s.needsHumanInput,
                humanInputPrompt: s.humanInputPrompt,
                humanInputStatus: s.humanInputStatus,
              },
            })

            // assigneeType：课程步骤全部由学员完成
            // ⚠️ 不能用模板的 assigneeRole（那是"谁教"，不是"谁学"）
            // 学员有 Agent → agent 步骤（Watch 自动执行）；纯人类学员 → human 步骤（Watch 跳过）
            const assigneeType: 'agent' | 'human' = learnerAgent ? 'agent' : 'human'

            await prisma.stepAssignee.create({
              data: { stepId: step.id, userId: auth.userId, isPrimary: true, assigneeType }
            }).catch(() => {})

            createdSteps.push(step)
          }

          // 激活可执行的首批步骤
          if (createdSteps.length > 0) {
            const startable = getStartableSteps(createdSteps)
            await activateAndNotifySteps(task.id, startable, { fromTemplate: true, templateName: course.name })
          }

          // 关联 taskId 到报名记录
          await prisma.courseEnrollment.update({
            where: { id: enrollment.id },
            data: { taskId: task.id },
          })

          // 通知学员任务已创建
          sendToUser(auth.userId, {
            type: 'task:created',
            taskId: task.id,
            title: task.title,
          })
          await createNotification({
            userId: auth.userId,
            type: 'task_assigned',
            title: '📚 课程学习任务已创建',
            content: `已为课程「${course.name}」创建学习任务，共 ${createdSteps.length} 个步骤`,
            taskId: task.id,
          })

          console.log(`[Academy/Enroll] ✅ 课程任务已创建 Task ${task.id}，共 ${createdSteps.length} 步`)
        }
      } catch (taskError) {
        // 任务创建失败不影响报名（非致命），记录日志
        console.error('[Academy/Enroll] 创建课程任务失败（报名仍成功）:', taskError)
      }
    }

    // 7. 通知课程创建者有新学员
    const studentName = auth.user?.name || '学员'
    if (course.creator?.id && course.creator.id !== auth.userId) {
      sendToUser(course.creator.id, {
        type: 'academy:new-enrollment' as any,
        templateId,
        courseName: course.name,
        studentName,
      })
      createNotification({
        userId: course.creator.id,
        type: 'step_assigned' as any,
        title: `📚 新学员报名了「${course.name}」`,
        content: `「${studentName}」报名了你的课程`,
      }).catch(() => {})
    }

    console.log(`[Academy/Enroll] 用户 ${auth.userId} 报名课程 "${course.name}" (${price > 0 ? `付费 ${price} Token` : '免费'})`)

    return NextResponse.json({
      message: price > 0 ? `报名成功，已扣除 ${price} Token` : '报名成功',
      enrollment,
      ...(createdTaskId ? { taskId: createdTaskId } : {}),
    })
  } catch (error) {
    console.error('[Academy/Enroll] 失败:', error)
    return NextResponse.json({ error: '报名失败' }, { status: 500 })
  }
}

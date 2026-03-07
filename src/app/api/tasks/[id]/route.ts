import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证：支持 Token 或 Session
async function authenticate(req: NextRequest) {
  // 先尝试 API Token
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }

  // 尝试 Session
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }

  return null
}

// 获取单个任务
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, email: true, avatar: true,
          agent: { select: { id: true, name: true, avatar: true, status: true, isMainAgent: true } }
        } },
        assignee: { select: { id: true, name: true, avatar: true } },
        workspace: { select: { id: true, name: true } },
        steps: {
          include: {
            assignee: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
                agent: { select: {
                  id: true, name: true, avatar: true, status: true, userId: true, isMainAgent: true,
                  parentAgent: { select: { id: true, name: true, user: { select: { id: true, name: true } } } }
                } }
              }
            },
            // B08: 多人指派
            assignees: {
              include: {
                user: { select: {
                  id: true, name: true, email: true, avatar: true,
                  agent: { select: {
                    id: true, name: true, avatar: true, status: true, userId: true, isMainAgent: true,
                    parentAgent: { select: { id: true, name: true, user: { select: { id: true, name: true } } } }
                  } }
                } }
              }
            },
            attachments: { select: { id: true, name: true, url: true, type: true } },
            // 🆕 最新提交记录（含提交者名字）
            submissions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                submitter: { select: { id: true, name: true, email: true, agent: { select: { name: true } } } }
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        // B12: 评分
        evaluations: {
          orderBy: { overallScore: 'desc' }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // 当前请求者（用于计算 viewerCanApprove）
    const auth = await authenticate(req)
    const viewerUserId = auth?.userId ?? null

    // 补充审批者信息（approvedBy 是 userId，无 Prisma relation，做 secondary lookup）
    const approvedByIds = task.steps
      .map(s => (s as any).approvedBy as string | null)
      .filter((id): id is string => !!id)
    const uniqueIds = [...new Set(approvedByIds)]
    const approvers = uniqueIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, name: true, email: true }
        })
      : []
    const approverMap = Object.fromEntries(approvers.map(u => [u.id, u]))

    // 🆕 服务端计算审批权限，彻底解决跨工作区审批按钮问题
    // 规则：任务创建者 OR 步骤被分配给当前用户（无论工作区）
    const isTaskCreator = viewerUserId != null && viewerUserId === task.creatorId

    const stepsWithApprover = task.steps.map(s => {
      const submissions = (s as any).submissions || []
      const rawSubmitter = submissions[0]?.submitter ?? null
      // 根据 StepAssignee.assigneeType 决定显示人名还是 Agent 名
      let submitterName = rawSubmitter?.name || rawSubmitter?.email
      if (rawSubmitter) {
        const assigneeRecord = ((s as any).assignees || []).find((a: any) => a.userId === rawSubmitter.id)
        if (assigneeRecord?.assigneeType === 'human') {
          // 人类提交 → 用人名
          submitterName = rawSubmitter.name || rawSubmitter.email
        } else if (rawSubmitter.agent?.name) {
          // Agent 提交 → 用 Agent 名
          submitterName = rawSubmitter.agent.name
        }
      }
      const lastSubmitter = rawSubmitter ? {
        id: rawSubmitter.id,
        name: submitterName,
        email: rawSubmitter.email,
      } : null
      return {
      ...s,
      submissions: undefined, // 不传 submissions 数组到前端（前端用 history API 拿完整列表）
      lastSubmitter,          // 🆕 最新提交者名字（Agent 优先）
      approvedByUser: (s as any).approvedBy ? approverMap[(s as any).approvedBy] ?? null : null,
      // 服务端算好，前端直接用
      // 规则：任务创建者 OR 步骤 assignee OR StepAssignee 成员
      // 当 viewerUserId 为 null（session 未能获取）时返回 null，让前端 fallback 接管
      viewerCanApprove: viewerUserId != null
        ? (isTaskCreator
           || s.assigneeId === viewerUserId
           // B08: 多人指派中的成员也有审批权限
           || ((s as any).assignees?.some((a: any) => a.user?.id === viewerUserId) ?? false))
        : null,
    }})

    return NextResponse.json({
      ...task,
      steps: stepsWithApprover,
      viewerIsCreator: isTaskCreator,   // 前端可用于「任务级别」权限（添加步骤、删除任务等）
    })

  } catch (error) {
    console.error('获取任务失败:', error)
    return NextResponse.json({ error: '获取任务失败' }, { status: 500 })
  }
}

// F04: 判断任务是否已开始（有步骤被领取/执行）
function isTaskStarted(taskStatus: string): boolean {
  return ['in_progress', 'review', 'done'].includes(taskStatus)
}

// F04: 允许全量编辑的字段
const FULL_EDIT_FIELDS = ['title', 'description', 'priority', 'dueDate', 'mode', 'status']
// F04: 任务开始后只允许的字段
const SUPPLEMENT_FIELDS = ['supplement', 'status', 'creatorComment', 'autoSummary']

// 更新任务（支持 Token 认证 + F04 编辑权限 + 编辑历史）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)

    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const data = await req.json()

    // 如果有 dueDate，转换为 Date
    if (data.dueDate) {
      data.dueDate = new Date(data.dueDate)
    }

    // 验证用户有权限更新这个任务（是创建者或执行者）
    const existingTask = await prisma.task.findUnique({
      where: { id }
    })

    if (!existingTask) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (existingTask.creatorId !== auth.userId && existingTask.assigneeId !== auth.userId) {
      return NextResponse.json({ error: '无权限更新此任务' }, { status: 403 })
    }

    // F04: 编辑权限检查
    const started = isTaskStarted(existingTask.status)
    const isCreator = existingTask.creatorId === auth.userId

    if (started && isCreator) {
      // 任务已开始 + 创建者 → 只能补充说明，不能改标题/描述等核心字段
      const requestedFields = Object.keys(data)
      const disallowed = requestedFields.filter(f => FULL_EDIT_FIELDS.includes(f) && !SUPPLEMENT_FIELDS.includes(f))
      if (disallowed.length > 0) {
        return NextResponse.json({
          error: `任务已开始执行，不能修改 ${disallowed.join('、')}。请使用"补充说明"功能。`,
          disallowedFields: disallowed,
          canSupplement: true
        }, { status: 403 })
      }
    }

    // F04: 记录编辑历史
    const historyEntries: { fieldName: string; oldValue: string | null; newValue: string | null; editType: string }[] = []
    const editType = started ? 'supplement' : 'full_edit'

    for (const key of Object.keys(data)) {
      if (['dueDate'].includes(key)) {
        // Date 类型比较
        const oldVal = (existingTask as any)[key] ? (existingTask as any)[key].toISOString() : null
        const newVal = data[key] ? data[key].toISOString() : null
        if (oldVal !== newVal) {
          historyEntries.push({ fieldName: key, oldValue: oldVal, newValue: newVal, editType })
        }
      } else if (['title', 'description', 'priority', 'mode', 'status', 'supplement', 'creatorComment'].includes(key)) {
        const oldVal = (existingTask as any)[key] ?? null
        const newVal = data[key] ?? null
        if (oldVal !== newVal) {
          historyEntries.push({
            fieldName: key,
            oldValue: typeof oldVal === 'string' ? oldVal : JSON.stringify(oldVal),
            newValue: typeof newVal === 'string' ? newVal : JSON.stringify(newVal),
            editType
          })
        }
      }
    }

    // 事务：更新任务 + 批量写入历史
    const task = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data,
        include: {
          creator: { select: { id: true, name: true, avatar: true } },
          assignee: { select: { id: true, name: true, avatar: true } },
          workspace: { select: { id: true, name: true } }
        }
      })

      if (historyEntries.length > 0) {
        await tx.taskEditHistory.createMany({
          data: historyEntries.map(e => ({
            taskId: id,
            editorId: auth.userId,
            ...e
          }))
        })
      }

      return updated
    })

    return NextResponse.json(task)

  } catch (error) {
    console.error('更新任务失败:', error)
    return NextResponse.json({ error: '更新任务失败' }, { status: 500 })
  }
}

// 删除任务
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    // 只有创建者可以删除任务
    const existingTask = await prisma.task.findUnique({
      where: { id }
    })

    if (!existingTask) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (existingTask.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有创建者可以删除任务' }, { status: 403 })
    }

    await prisma.task.delete({
      where: { id }
    })

    return NextResponse.json({ message: '删除成功' })

  } catch (error) {
    console.error('删除任务失败:', error)
    return NextResponse.json({ error: '删除任务失败' }, { status: 500 })
  }
}

// creatorComment 和 autoSummary 字段通过上方已有的 PATCH handler 支持

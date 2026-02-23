import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }

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

// 获取任务列表
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    // 只返回与当前用户相关的任务：
    // 1. 我创建的任务
    // 2. 我是步骤执行人的任务
    // 3. 我是工作区 owner/admin（看整个工作区所有任务）
    // 4. 我通过邀请链接被明确分享的任务（即使没有步骤也能看到）
    //    → 接受邀请时会在 InviteToken 记录 inviteeId，永久保留可见性
    const visibilityFilter = {
      OR: [
        { creatorId: auth.userId },
        { steps: { some: { assigneeId: auth.userId } } },
        {
          workspace: {
            members: { some: { userId: auth.userId, role: { in: ['owner', 'admin'] } } }
          }
        },
        {
          // 通过邀请链接被分享的任务（跨工作区可见性核心）
          invites: { some: { inviteeId: auth.userId, taskId: { not: null } } }
        }
      ]
    }

    const tasks = await prisma.task.findMany({
      where: workspaceId
        ? { workspaceId, ...visibilityFilter }
        : visibilityFilter,
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        workspace: { select: { id: true, name: true } },
        steps: {
          select: {
            id: true,
            title: true,
            status: true,
            stepType: true,
            assigneeId: true,
            assignee: { select: { id: true, name: true, avatar: true } }
          },
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(tasks)

  } catch (error) {
    console.error('获取任务失败:', error)
    return NextResponse.json({ error: '获取任务失败' }, { status: 500 })
  }
}

// 创建任务
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const { 
      title, 
      description, 
      status, 
      priority,
      mode,           // solo | team
      dueDate, 
      assigneeId,
      assigneeEmail,  // 支持通过邮箱分配
      workspaceId,
      steps,          // 🆕 Agent 可直接传入步骤数组，跳过 decompose 环节
    } = await req.json()

    if (!title) {
      return NextResponse.json(
        { error: '标题不能为空' },
        { status: 400 }
      )
    }

    // 如果没有指定 workspaceId，使用用户的默认工作区
    let finalWorkspaceId = workspaceId
    if (!finalWorkspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId },
        select: { workspaceId: true }
      })
      if (!membership) {
        return NextResponse.json(
          { error: '请先创建或加入一个工作区' },
          { status: 400 }
        )
      }
      finalWorkspaceId = membership.workspaceId
    }

    // 解析执行者
    let finalAssigneeId = assigneeId
    if (!finalAssigneeId && assigneeEmail) {
      const assignee = await prisma.user.findUnique({
        where: { email: assigneeEmail }
      })
      if (assignee) {
        finalAssigneeId = assignee.id
      }
      // 如果用户不存在，暂时不分配（可以后续发邀请）
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status: status || 'todo',
        priority: priority || 'medium',
        mode: mode || 'solo',
        dueDate: dueDate ? new Date(dueDate) : null,
        creatorId: auth.userId,
        assigneeId: finalAssigneeId,
        workspaceId: finalWorkspaceId
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        workspace: { select: { id: true, name: true } }
      }
    })

    // 🆕 Agent 直接传入步骤：立即创建，跳过 decompose
    const prebuiltSteps: any[] = []
    if (Array.isArray(steps) && steps.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        if (!s.title) continue
        const createdStep = await prisma.taskStep.create({
          data: {
            title: s.title,
            description: s.description || null,
            order: s.order ?? (i + 1),
            taskId: task.id,
            stepType: s.stepType || 'task',
            assigneeId: s.assigneeId || null,
            requiresApproval: s.requiresApproval !== false,  // 默认 true
            parallelGroup: s.parallelGroup || null,
            inputs: s.inputs ? JSON.stringify(s.inputs) : null,
            outputs: s.outputs ? JSON.stringify(s.outputs) : null,
            skills: s.skills ? JSON.stringify(s.skills) : null,
            status: 'pending',
            agentStatus: s.assigneeId ? 'pending' : null,
          }
        })
        prebuiltSteps.push(createdStep)
      }

      // 通知第一个可以开始的步骤
      if (prebuiltSteps.length > 0) {
        const firstStep = prebuiltSteps[0]
        if (firstStep.assigneeId) {
          sendToUser(firstStep.assigneeId, {
            type: 'step:ready',
            taskId: task.id,
            stepId: firstStep.id,
            title: firstStep.title,
          })
        }
      }
      console.log(`[Task/Create] 直接创建 ${prebuiltSteps.length} 个步骤（跳过 decompose）`)
    }

    // 🔔 发送实时通知
    // 通知创建者（如果在线）
    sendToUser(auth.userId, {
      type: 'task:created',
      taskId: task.id,
      title: task.title
    })

    // 通知被分配者（如果有）
    if (finalAssigneeId && finalAssigneeId !== auth.userId) {
      sendToUser(finalAssigneeId, {
        type: 'task:created',
        taskId: task.id,
        title: task.title
      })
    }

    // 🆕 Solo 模式自动触发拆解：任务创建即通知主 Agent，无需手动点"AI拆解"
    // 如果 Agent 已直接传入步骤，则跳过 decompose
    if (task.mode === 'solo' && task.description && prebuiltSteps.length === 0) {
      try {
        const allMembers = await prisma.workspaceMember.findMany({
          where: { workspaceId: finalWorkspaceId },
          include: {
            user: {
              select: {
                id: true,
                agent: { select: { id: true, name: true, isMainAgent: true } }
              }
            }
          }
        })
        const mainMember = allMembers.find(m => (m.user.agent as any)?.isMainAgent === true)

        if (mainMember) {
          const mainAgentUserId = mainMember.user.id
          const mainAgentName = (mainMember.user.agent as any)?.name || '主Agent'

          const decomposeStep = await prisma.taskStep.create({
            data: {
              title: `📋 拆解任务：${task.title}`,
              description: `请分析任务描述和团队能力，将任务拆解为具体步骤并分配给对应 Agent。\n\n任务描述：\n${task.description}\n\n要求：\n1. 拆解为可独立执行的子步骤\n2. 为每步指定最合适的 assignee（Agent名字）\n3. 判断哪些步骤可以并行（parallelGroup 相同字符串）\n4. 判断每步是否需要人类审批（requiresApproval）\n5. 返回 JSON 格式步骤数组`,
              order: 1,
              taskId: task.id,
              stepType: 'decompose',
              assigneeId: mainAgentUserId,
              requiresApproval: false,
              outputs: JSON.stringify(['steps-json']),
              skills: JSON.stringify(['task-decompose', 'team-management']),
              status: 'pending',
              agentStatus: 'pending',
            }
          })

          sendToUser(mainAgentUserId, {
            type: 'step:ready',
            taskId: task.id,
            stepId: decomposeStep.id,
            title: decomposeStep.title,
            stepType: 'decompose',
            taskDescription: task.description
          })

          console.log(`[Task/Create] Solo 任务已自动触发 decompose → 主Agent ${mainAgentName}`)
        }
      } catch (e) {
        // 非致命，任务创建不受影响
        console.warn('[Task/Create] 自动 decompose 触发失败:', e)
      }
    }

    return NextResponse.json({
      ...task,
      steps: prebuiltSteps.length > 0 ? prebuiltSteps : undefined,
    })

  } catch (error) {
    console.error('创建任务失败:', error)
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 })
  }
}

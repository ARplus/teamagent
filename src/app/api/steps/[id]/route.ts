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

// GET /api/steps/[id] - 获取步骤详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 认证（可选，未登录用户按无权限处理）
    const auth = await authenticate(req)
    const viewerUserId = auth?.userId ?? null

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: { select: { id: true, title: true, templateId: true, template: { select: { name: true } }, mode: true, creatorId: true } },
        assignee: {
          select: {
            id: true, name: true, avatar: true,
            agent: { select: { id: true, name: true, status: true,
              parentAgent: { select: { id: true, name: true, user: { select: { id: true, name: true } } } }
            } }
          }
        },
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true,
              agent: { select: { id: true, name: true, status: true,
                parentAgent: { select: { id: true, name: true, user: { select: { id: true, name: true } } } }
              } }
            } }
          }
        },
        attachments: true
      }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 隐私保护：与 tasks/[id] 路由保持完全一致的遮罩逻辑
    const isTeamTask = (step.task as any)?.mode === 'team'
    const isStepAssignee = viewerUserId != null && (
      step.assigneeId === viewerUserId ||
      ((step as any).assignees?.some((a: any) => a.user?.id === viewerUserId) ?? false)
    )
    const isTaskCreator = viewerUserId != null && viewerUserId === (step.task as any)?.creatorId
    const isHumanOfAssignee = isTeamTask && viewerUserId != null && (
      (step as any).assignee?.agent?.parentAgent?.user?.id === viewerUserId ||
      ((step as any).assignees?.some((a: any) =>
        a.user?.agent?.parentAgent?.user?.id === viewerUserId
      ) ?? false)
    )
    const canSeeResult = isTeamTask
      ? (isStepAssignee || isHumanOfAssignee)
      : (isTaskCreator || isStepAssignee)

    // requiresApproval 步骤：done（审批通过）之前，对方不可见 result / description / attachments
    const shouldMask = (step as any).requiresApproval && step.status !== 'done' && !canSeeResult

    // 附加 fromTemplate / templateName（从 Task 的 template 关联推导）
    const fromTemplate = !!step.task?.templateId
    const templateName = (step.task as any)?.template?.name || null
    return NextResponse.json({
      ...step,
      result: shouldMask ? null : (step as any).result,
      description: shouldMask ? null : step.description,
      attachments: shouldMask ? [] : step.attachments,
      fromTemplate,
      templateName,
    })

  } catch (error) {
    console.error('获取步骤失败:', error)
    return NextResponse.json({ error: '获取步骤失败' }, { status: 500 })
  }
}

// PATCH /api/steps/[id] - 更新步骤
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 权限：任务创建者、步骤负责人、或同工作区成员均可更新
    const isCreatorOrAssignee = step.task.creatorId === auth.userId || step.assigneeId === auth.userId
    if (!isCreatorOrAssignee) {
      const isMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: step.task.workspaceId, userId: auth.userId }
      })
      if (!isMember) {
        return NextResponse.json({ error: '无权限更新此步骤（非工作区成员）' }, { status: 403 })
      }
    }

    const data = await req.json()

    // 允许更新的字段
    const updateData: any = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.description !== undefined) updateData.description = data.description
    if (data.status !== undefined) updateData.status = data.status
    if (data.agentStatus !== undefined) updateData.agentStatus = data.agentStatus
    if (data.result !== undefined) updateData.result = data.result
    if (data.order !== undefined) updateData.order = data.order
    if (data.parallelGroup !== undefined) updateData.parallelGroup = data.parallelGroup || null
    // V1.1: 人类资料补充
    if (data.needsHumanInput !== undefined) updateData.needsHumanInput = data.needsHumanInput
    if (data.humanInputPrompt !== undefined) updateData.humanInputPrompt = data.humanInputPrompt
    if (data.humanInputStatus !== undefined) updateData.humanInputStatus = data.humanInputStatus
    // V1.1: 未分配
    if (data.unassigned !== undefined) updateData.unassigned = data.unassigned
    if (data.unassignedReason !== undefined) updateData.unassignedReason = data.unassignedReason
    // B08: 多人指派路径
    if (data.assigneeIds && Array.isArray(data.assigneeIds) && data.assigneeIds.length > 0) {
      // 验证所有 assignee 是工作区成员
      for (const a of data.assigneeIds) {
        const isMember = await prisma.workspaceMember.findFirst({
          where: { workspaceId: step.task.workspaceId, userId: a.userId }
        })
        if (!isMember) {
          return NextResponse.json({ error: `用户 ${a.userId} 不在工作区中` }, { status: 403 })
        }
      }

      // 获取所有被指派者的显示名
      const userIds = data.assigneeIds.map((a: any) => a.userId)
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, agent: { select: { name: true } } }
      })
      const nameMap = new Map(users.map(u => [u.id, u.agent?.name || u.name || u.email]))

      // 事务：删旧 → 创建新 → 更新步骤
      await prisma.$transaction(async (tx) => {
        await tx.stepAssignee.deleteMany({ where: { stepId: id } })
        await tx.stepAssignee.createMany({
          data: data.assigneeIds.map((a: any, i: number) => ({
            stepId: id,
            userId: a.userId,
            assigneeType: a.assigneeType || 'agent',
            isPrimary: i === 0,
          }))
        })
        const names = data.assigneeIds.map((a: any) => nameMap.get(a.userId) || '未知')
        await tx.taskStep.update({
          where: { id },
          data: {
            assigneeId: data.assigneeIds[0].userId,
            assigneeNames: JSON.stringify(names),
            completionMode: data.completionMode || 'any',
            unassigned: false,
            unassignedReason: null,
          }
        })
      })
    }
    // B08: 清空所有指派
    else if (data.assigneeIds && Array.isArray(data.assigneeIds) && data.assigneeIds.length === 0) {
      await prisma.$transaction(async (tx) => {
        await tx.stepAssignee.deleteMany({ where: { stepId: id } })
        await tx.taskStep.update({
          where: { id },
          data: { assigneeId: null, assigneeNames: null }
        })
      })
    }
    // B7-fix: 支持 assigneeHint（名字/昵称）→ 自动解析为 userId
    else if (data.assigneeHint && !data.assigneeId) {
      const hint = data.assigneeHint.trim()
      const role = data.assigneeRole // 'human' | 'agent' | 'auto' | undefined
      const wsMembers = await prisma.workspaceMember.findMany({
        where: { workspaceId: step.task.workspaceId },
        include: { user: { select: { id: true, name: true, nickname: true, agent: { select: { name: true } } } } },
      })
      const matched = wsMembers.find(m => {
        const agentName = (m.user.agent as any)?.name
        const userName = m.user.name
        const userNick = m.user.nickname
        if (role === 'human') {
          if (userName === hint || userNick === hint) return true
          if (userName && (userName.includes(hint) || hint.includes(userName))) return true
          if (userNick && (userNick.includes(hint) || hint.includes(userNick))) return true
          return false
        }
        if (role === 'agent') {
          if (agentName && agentName === hint) return true
          if (agentName && (agentName.includes(hint) || hint.includes(agentName))) return true
          return false
        }
        if (agentName && agentName === hint) return true
        if (userName === hint || userNick === hint) return true
        if (agentName && (agentName.includes(hint) || hint.includes(agentName))) return true
        if (userName && (userName.includes(hint) || hint.includes(userName))) return true
        return false
      })
      if (matched) {
        const resolvedId = matched.user.id
        updateData.assigneeId = resolvedId
        updateData.unassigned = false
        updateData.unassignedReason = null
        // P0-1 fix: assigneeRole 优先，仅 auto 时 auto-detect
        let detectedType: 'agent' | 'human'
        if (role === 'human') {
          detectedType = 'human'
        } else if (role === 'agent') {
          detectedType = 'agent'
        } else {
          const assigneeAgent = await prisma.agent.findUnique({ where: { userId: resolvedId }, select: { id: true } })
          detectedType = assigneeAgent ? 'agent' : 'human'
        }
        await prisma.stepAssignee.deleteMany({ where: { stepId: id } })
        await prisma.stepAssignee.create({
          data: { stepId: id, userId: resolvedId, assigneeType: detectedType, isPrimary: true }
        })
        console.log(`[Step/PATCH] assigneeHint "${hint}" → 解析为 userId ${resolvedId}`)
      } else {
        updateData.unassigned = true
        updateData.unassignedReason = `指定「${hint}」但未匹配到工作区成员`
        console.log(`[Step/PATCH] assigneeHint "${hint}" → 未匹配到成员`)
      }
    }
    // 旧路径：单人分配（向后兼容）— B7-fix: 放宽权限，不再 403 阻止，改为自动加入工作区
    else if (data.assigneeId !== undefined) {
      const newAssigneeId = data.assigneeId || null
      if (newAssigneeId) {
        const isMember = await prisma.workspaceMember.findFirst({
          where: { workspaceId: step.task.workspaceId, userId: newAssigneeId }
        })
        if (!isMember) {
          // B7-fix: 自动将目标用户加入工作区（member 角色），不再 403 拒绝
          const userExists = await prisma.user.findUnique({ where: { id: newAssigneeId }, select: { id: true } })
          if (!userExists) {
            return NextResponse.json({ error: '用户不存在' }, { status: 404 })
          }
          await prisma.workspaceMember.create({
            data: { workspaceId: step.task.workspaceId, userId: newAssigneeId, role: 'member' }
          }).catch(() => {}) // 忽略重复
          console.log(`[Step/PATCH] B7-fix: 自动将用户 ${newAssigneeId} 加入工作区 ${step.task.workspaceId}`)
        }
      }
      updateData.assigneeId = newAssigneeId
      // V1.1: 分配后清除 unassigned 标记
      if (newAssigneeId) {
        updateData.unassigned = false
        updateData.unassignedReason = null
      }
      // 若当前是 waiting_human 且改为 agent 执行，自动重置为 pending 让 Agent 可 claim
      if (newAssigneeId) {
        const currentStep = await prisma.taskStep.findUnique({ where: { id }, select: { status: true } })
        if (currentStep?.status === 'waiting_human') {
          const finalType = data.assigneeType === 'human' ? 'human'
            : data.assigneeType === 'agent' ? 'agent'
            : (await prisma.user.findUnique({ where: { id: newAssigneeId }, select: { agent: { select: { id: true } } } }))?.agent ? 'agent' : 'human'
          if (finalType === 'agent') {
            updateData.status = 'pending'
          }
        }
      }
      // 同步 StepAssignee 表
      // P0-1 fix: 支持 data.assigneeType 明确指定
      if (newAssigneeId) {
        let finalType: 'agent' | 'human'
        if (data.assigneeType === 'human' || data.assigneeType === 'agent') {
          finalType = data.assigneeType
        } else {
          const user = await prisma.user.findUnique({
            where: { id: newAssigneeId },
            select: { agent: { select: { id: true } } }
          })
          finalType = user?.agent ? 'agent' : 'human'
        }
        await prisma.stepAssignee.deleteMany({ where: { stepId: id } })
        await prisma.stepAssignee.create({
          data: {
            stepId: id, userId: newAssigneeId,
            assigneeType: finalType,
            isPrimary: true,
          }
        })
      } else {
        await prisma.stepAssignee.deleteMany({ where: { stepId: id } })
      }
    }
    if (data.completionMode !== undefined) {
      updateData.completionMode = data.completionMode
    }

    const updated = await prisma.taskStep.update({
      where: { id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true, agent: { select: { id: true, name: true, status: true } } } },
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true, agent: { select: { id: true, name: true, status: true } } } }
          }
        },
        attachments: true
      }
    })

    // NEW-3 fix: 手动分配后 SSE 通知被分配的 Agent
    const newAssigneeIdForSSE = data.assigneeId || null
    if (newAssigneeIdForSSE && newAssigneeIdForSSE !== step.assigneeId) {
      // 只通知 agent 类型的被分配者（人类不需要）
      const isAgentUser = await prisma.agent.findFirst({ where: { userId: newAssigneeIdForSSE }, select: { id: true } })
      if (isAgentUser && updated.status === 'pending') {
        sendToUser(newAssigneeIdForSSE, {
          type: 'step:ready',
          taskId: step.taskId,
          stepId: id,
          title: step.title,
          assigneeType: 'agent',
        })
        console.log(`[Step/PATCH] NEW-3: 手动分配 → step:ready 已推送给 ${newAssigneeIdForSSE}`)
      }
    }

    // V1.1: humanInputStatus 变更为 provided 时，SSE 通知分配的 Agent
    if (data.humanInputStatus === 'provided' && step.humanInputStatus !== 'provided') {
      // 通知所有分配者（主要是 Agent）
      const assignees = await prisma.stepAssignee.findMany({
        where: { stepId: id },
        select: { userId: true }
      })
      for (const a of assignees) {
        sendToUser(a.userId, {
          type: 'step:human-input-provided',
          taskId: step.taskId,
          stepId: id,
          title: step.title,
        })
      }
      // 也通知 assigneeId（兼容单人分配）
      if (step.assigneeId && !assignees.some(a => a.userId === step.assigneeId)) {
        sendToUser(step.assigneeId, {
          type: 'step:human-input-provided',
          taskId: step.taskId,
          stepId: id,
          title: step.title,
        })
      }
      console.log(`[Step/PATCH] humanInput provided → 通知 ${assignees.length} 个 assignee`)
    }

    return NextResponse.json(updated)

  } catch (error) {
    console.error('更新步骤失败:', error)
    return NextResponse.json({ error: '更新步骤失败' }, { status: 500 })
  }
}

// DELETE /api/steps/[id] - 删除步骤
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 只有任务创建者可以删除步骤
    if (step.task.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有任务创建者可以删除步骤' }, { status: 403 })
    }

    await prisma.taskStep.delete({
      where: { id }
    })

    return NextResponse.json({ message: '删除成功' })

  } catch (error) {
    console.error('删除步骤失败:', error)
    return NextResponse.json({ error: '删除步骤失败' }, { status: 500 })
  }
}

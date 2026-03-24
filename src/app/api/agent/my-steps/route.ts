import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/agent/my-steps
 *
 * Solo Mode 核心接口：Agent 查询自己被分配的待处理步骤
 *
 * 认证：Bearer token
 * 返回：当前 Agent 用户被分配的 pending/in_progress 步骤列表
 */
export async function GET(req: NextRequest) {
  try {
    const tokenAuth = await authenticateRequest(req)
    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status') // 可选：pending/in_progress/all

    const whereStatus = statusFilter === 'all'
      ? undefined
      : statusFilter === 'in_progress'
        ? 'in_progress'
        : statusFilter === 'pending'
          ? 'pending'
          : { in: ['pending', 'in_progress'] } // 默认返回两种

    // 查当前 Agent 的身份信息（包括子 Agent 列表，用于影子军团轮询兜底）
    const myAgent = await prisma.agent.findUnique({
      where: { userId: tokenAuth.user.id },
      select: {
        id: true,
        childAgents: {
          select: { id: true, userId: true, name: true, soul: true }
        }
      }
    })
    const subAgentUserIds = (myAgent?.childAgents?.map(a => a.userId).filter(Boolean) ?? []) as string[]

    const stepInclude = {
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          mode: true,
          creator: { select: { id: true, name: true, email: true } }
        }
      },
      assignee: {
        select: {
          id: true,
          name: true,
          agent: { select: { id: true, name: true, capabilities: true } }
        }
      }
    }

    // B08: 同时查 assigneeId 和 StepAssignee（我自己的步骤）
    const steps = await prisma.taskStep.findMany({
      where: {
        OR: [
          { assigneeId: tokenAuth.user.id },
          { assignees: { some: { userId: tokenAuth.user.id } } }
        ],
        status: whereStatus as any
      },
      include: stepInclude,
      orderBy: [
        { task: { createdAt: 'desc' } },
        { order: 'asc' }
      ]
    })

    // 影子军团兜底轮询：查子 Agent 的 pending/in_progress 步骤（SSE 丢失时恢复用）
    let delegatedSteps: any[] = []
    if (subAgentUserIds.length > 0) {
      delegatedSteps = await prisma.taskStep.findMany({
        where: {
          OR: [
            { assigneeId: { in: subAgentUserIds } },
            { assignees: { some: { userId: { in: subAgentUserIds } } } }
          ],
          status: whereStatus as any
        },
        include: stepInclude,
        orderBy: [
          { task: { createdAt: 'desc' } },
          { order: 'asc' }
        ]
      })
    }

    const formatStep = (step: any, delegated?: { soul: string | null; userId: string | null; name: string | null }) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      status: step.status,
      order: step.order,
      stepType: step.stepType,
      inputs: step.inputs,
      outputs: step.outputs,
      skills: step.skills,
      rejectionReason: step.rejectionReason,
      requiresApproval: step.requiresApproval,
      parallelGroup: (step as any).parallelGroup,
      task: step.task,
      // 影子军团字段：Watch 代执行时需要注入子 Agent soul
      isDelegated: !!delegated,
      assigneeSoul: delegated?.soul ?? null,
      assigneeUserId: delegated?.userId ?? step.assigneeId,
      assigneeName: delegated?.name ?? null,
      // 告诉 Agent 该怎么操作
      actions: {
        claim: step.status === 'pending'
          ? `POST /api/steps/${step.id}/claim`
          : null,
        submit: step.status === 'in_progress'
          ? `POST /api/steps/${step.id}/submit`
          : null
      }
    })

    return NextResponse.json({
      count: steps.length + delegatedSteps.length,
      steps: steps.map(s => formatStep(s)),
      // 独立字段让 Watch 区分处理
      delegatedSteps: delegatedSteps.map(s => {
        const subAgent = myAgent?.childAgents?.find(a => a.userId === s.assigneeId)
        return formatStep(s, subAgent ? { soul: subAgent.soul, userId: subAgent.userId, name: subAgent.name } : undefined)
      })
    })
  } catch (error) {
    console.error('获取我的步骤失败:', error)
    return NextResponse.json({ error: '获取步骤失败' }, { status: 500 })
  }
}

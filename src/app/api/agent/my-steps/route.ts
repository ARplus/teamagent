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

    const steps = await prisma.taskStep.findMany({
      where: {
        assigneeId: tokenAuth.user.id,
        status: whereStatus as any
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            dueDate: true,
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
      },
      orderBy: [
        { task: { createdAt: 'desc' } },
        { order: 'asc' }
      ]
    })

    return NextResponse.json({
      count: steps.length,
      steps: steps.map(step => ({
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
        task: step.task,
        // 告诉 Agent 该怎么操作
        actions: {
          claim: step.status === 'pending'
            ? `POST /api/steps/${step.id}/claim`
            : null,
          submit: step.status === 'in_progress'
            ? `POST /api/steps/${step.id}/submit`
            : null
        }
      }))
    })
  } catch (error) {
    console.error('获取我的步骤失败:', error)
    return NextResponse.json({ error: '获取步骤失败' }, { status: 500 })
  }
}

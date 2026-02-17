import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { processWorkflowAfterSubmit } from '@/lib/workflow-engine'

/**
 * POST /api/steps/[id]/submit
 * 
 * Agent 提交步骤结果，等待人类审核
 * 
 * Body:
 * {
 *   result: string,          // 结果描述
 *   summary?: string,        // AI 生成的摘要
 *   attachments?: [          // 附件列表
 *     { name: string, url: string, type?: string }
 *   ]
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const tokenAuth = await authenticateRequest(req)
    
    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }

    const { result, summary, attachments } = await req.json()

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: {
          select: { id: true, title: true, creatorId: true }
        }
      }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 检查是否是负责人
    if (step.assigneeId !== tokenAuth.user.id) {
      return NextResponse.json({ error: '你不是此步骤的负责人' }, { status: 403 })
    }

    // 检查状态
    if (step.status !== 'in_progress') {
      return NextResponse.json({ error: '步骤未在进行中' }, { status: 400 })
    }

    // 计算 Agent 执行时间
    const now = new Date()
    const agentDurationMs = step.startedAt 
      ? now.getTime() - new Date(step.startedAt).getTime()
      : null

    // 更新步骤状态
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'waiting_approval',
        agentStatus: 'waiting_approval',
        result: result || '任务已完成，等待审核',
        summary: summary || null,
        completedAt: now,
        reviewStartedAt: now,  // 开始等待审核
        agentDurationMs
      }
    })

    // 如果有附件，创建附件记录
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      await prisma.attachment.createMany({
        data: attachments.map((att: { name: string; url: string; type?: string }) => ({
          name: att.name,
          url: att.url,
          type: att.type || 'file',
          stepId: id,
          uploaderId: tokenAuth.user.id
        }))
      })
    }

    // 更新 Agent 状态（如果存在）
    const agent = await prisma.agent.findUnique({
      where: { userId: tokenAuth.user.id }
    })
    if (agent) {
      await prisma.agent.update({
        where: { userId: tokenAuth.user.id },
        data: { status: 'online' }
      })
    }

    // 🔔 发送实时通知
    // 通知任务创建者：有步骤等待审核
    if (step.task.creatorId) {
      sendToUser(step.task.creatorId, {
        type: 'approval:requested',
        taskId: step.task.id,
        stepId: id,
        title: step.title
      })
    }

    // 通知提交者：已提交成功
    sendToUser(tokenAuth.user.id, {
      type: 'step:completed',
      taskId: step.task.id,
      stepId: id,
      title: step.title
    })

    // 🔄 动态工作流引擎：检查是否需要调整后续步骤
    let workflowResult = null
    try {
      workflowResult = await processWorkflowAfterSubmit(
        id,
        result || '',
        summary
      )
      console.log('[Submit] 工作流处理结果:', workflowResult)
    } catch (error) {
      console.error('[Submit] 工作流处理失败:', error)
      // 工作流失败不影响提交成功
    }

    return NextResponse.json({
      message: '已提交，等待人类审核',
      step: updated,
      workflow: workflowResult
    })

  } catch (error) {
    console.error('提交步骤失败:', error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: '提交失败', detail: errorMessage }, { status: 500 })
  }
}

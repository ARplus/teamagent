import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { processWorkflowAfterSubmit } from '@/lib/workflow-engine'
import { generateSummary } from '@/lib/ai-summary'
import { createNotification, notificationTemplates } from '@/lib/notifications'

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

    // 🤖 如果没有提供 summary，自动生成
    let finalSummary = summary
    if (!summary && result) {
      console.log('[Submit] 自动生成 AI Summary...')
      const aiSummary = await generateSummary({
        stepTitle: step.title,
        result: result,
        attachmentCount: attachments?.length || 0
      })
      if (aiSummary) {
        finalSummary = aiSummary
      }
    }

    // 1+2+3 事务：确保 Submission、Step 状态、Attachment 同时成功或同时回滚
    const resultText = result || '任务已完成，等待审核'
    const [submission, updated] = await prisma.$transaction(async (tx) => {
      // 1. 创建 StepSubmission 记录
      const sub = await tx.stepSubmission.create({
        data: {
          stepId: id,
          submitterId: tokenAuth.user.id,
          result: resultText,
          summary: finalSummary || null,
          durationMs: agentDurationMs
        }
      })

      // 2. 更新步骤状态
      // requiresApproval=false → 直接自动通过，跳过人工审核
      const autoApprove = step.requiresApproval === false
      const newStatus = autoApprove ? 'done' : 'waiting_approval'
      const newAgentStatus = autoApprove ? 'done' : 'waiting_approval'

      const upd = await tx.taskStep.update({
        where: { id },
        data: {
          status: newStatus,
          agentStatus: newAgentStatus,
          result: resultText,
          summary: finalSummary || null,
          completedAt: now,
          reviewStartedAt: autoApprove ? null : now,
          approvedAt: autoApprove ? now : null,
          agentDurationMs
        }
      })

      // 3. 附件（如有）
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        await tx.attachment.createMany({
          data: attachments.map((att: { name: string; url: string; type?: string }) => ({
            name: att.name,
            url: att.url,
            type: att.type || 'file',
            submissionId: sub.id,
            uploaderId: tokenAuth.user.id
          }))
        })
      }

      return [sub, upd]
    })

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
    const autoApproved = step.requiresApproval === false
    // 需要人工审核时才通知任务创建者
    if (!autoApproved && step.task.creatorId) {
      sendToUser(step.task.creatorId, {
        type: 'approval:requested',
        taskId: step.task.id,
        stepId: id,
        title: step.title
      })
      
      // 站内信通知
      const submitterName = tokenAuth.user.name || tokenAuth.user.email
      const template = notificationTemplates.stepWaiting(step.title, step.task.title, submitterName)
      await createNotification({
        userId: step.task.creatorId,
        ...template,
        taskId: step.task.id,
        stepId: id
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
      message: autoApproved ? '已提交并自动通过（无需人工审核）' : '已提交，等待人类审核',
      autoApproved,
      step: updated,
      workflow: workflowResult
    })

  } catch (error) {
    console.error('提交步骤失败:', error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: '提交失败', detail: errorMessage }, { status: 500 })
  }
}

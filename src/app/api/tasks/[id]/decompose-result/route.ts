/**
 * POST /api/tasks/:id/decompose-result
 *
 * 主 Agent 回写拆解结果。由 agent-worker 在收到 task:decompose-request SSE 后调用。
 * 包含幂等检查（decomposeStatus 必须是 "pending"），防止超时降级后的重复写入。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { cancelDecomposeTimeout, createStepsFromParseResult, fetchWorkspaceTeam } from '@/lib/decompose-orchestrator'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params

    // 1. 认证（API Token）
    const auth = await authenticateRequest(req)
    if (!auth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 2. 解析请求体
    const body = await req.json()
    const { steps, reasoning } = body
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: '步骤列表不能为空' }, { status: 400 })
    }

    // 3. 加载任务
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true, title: true, description: true,
        decomposeStatus: true, creatorId: true, workspaceId: true,
      }
    })
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // 4. 幂等检查：只接受 "pending" 状态
    if (task.decomposeStatus !== 'pending') {
      console.log(`[DecomposeResult] taskId=${taskId} 状态为 ${task.decomposeStatus}，拒绝重复写入`)
      return NextResponse.json({
        error: '任务拆解已完成或正在降级处理中',
        currentStatus: task.decomposeStatus,
      }, { status: 409 })
    }

    // 5. 验证调用者是工作区成员（主 Agent）
    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: task.workspaceId, userId: auth.user.id },
      include: { user: { select: { agent: { select: { isMainAgent: true } } } } }
    })
    if (!membership) {
      return NextResponse.json({ error: '调用者不是工作区成员' }, { status: 403 })
    }

    // 6. 取消超时计时器
    const cancelled = cancelDecomposeTimeout(taskId)
    console.log(`[DecomposeResult] taskId=${taskId} 收到 Agent 回写 (${steps.length} 步)${cancelled ? '，已取消超时' : ''}`)

    // 7. 原子更新拆解状态
    await prisma.task.update({
      where: { id: taskId },
      data: { decomposeStatus: 'done', decomposeEngine: 'main-agent' }
    })

    // 8. 创建步骤 + 通知
    const members = await fetchWorkspaceTeam(task.workspaceId)
    const createdSteps = await createStepsFromParseResult(
      taskId, steps, members, task.creatorId, 'main-agent'
    )

    if (reasoning) {
      console.log(`[DecomposeResult] Agent 拆解理由: ${reasoning}`)
    }

    console.log(`[DecomposeResult] ✅ 完成：${createdSteps.length} 步已创建`)

    return NextResponse.json({
      message: `✅ 已接收 Agent 拆解结果：${createdSteps.length} 个步骤`,
      stepsCreated: createdSteps.length,
      engine: 'main-agent',
    })

  } catch (e: any) {
    console.error('[DecomposeResult] 错误:', e?.message)
    return NextResponse.json({ error: e?.message || '内部错误' }, { status: 500 })
  }
}

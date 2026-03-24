/**
 * POST /api/tasks/{id}/decompose-ack
 *
 * 主 Agent 收到 task:decompose-request 后立即回调此接口，
 * 取消服务端 60s 降级计时器，防止 Hub LLM 兜底介入。
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { cancelDecomposeTimeout } from '@/lib/decompose-orchestrator'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params

    const auth = await authenticateRequest(req)
    if (!auth) {
      return NextResponse.json({ error: '请提供 API Token' }, { status: 401 })
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, decomposeStatus: true },
    })
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    const cancelled = cancelDecomposeTimeout(taskId)

    // ACK 后标记 decomposeStatus = 'processing'，防止超时回调误判为无响应
    if (task.decomposeStatus === 'pending') {
      await prisma.task.update({
        where: { id: taskId },
        data: { decomposeStatus: 'processing' },
      })
    }

    console.log(`[DecomposeAck] taskId=${taskId} agent=${auth.user.id} cancelled=${cancelled} status→processing`)

    return NextResponse.json({ ok: true, cancelled, taskId })
  } catch (error) {
    console.error('[DecomposeAck] 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

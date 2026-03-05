/**
 * POST /api/tasks/:id/decompose-ack
 *
 * 主 Agent 收到 decompose-request SSE 后立即调用，
 * 告知 Hub "我收到了，正在拆解"，Hub 取消千问 fallback 计时器。
 *
 * 轻量级端点：只取消计时器 + 更新日志，不做任何业务操作。
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { cancelDecomposeTimeout } from '@/lib/decompose-orchestrator'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params

  const auth = await authenticateRequest(req)
  if (!auth) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const cancelled = cancelDecomposeTimeout(taskId)
  console.log(`[DecomposeACK] taskId=${taskId} Agent=${auth.user.name || auth.user.id} → ${cancelled ? '✅ 已取消 fallback 计时器' : '⚠️ 无活跃计时器'}`)

  return NextResponse.json({ ok: true, cancelled })
}

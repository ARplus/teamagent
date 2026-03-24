import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { activateAndNotifySteps, getStartableSteps } from '@/lib/step-scheduling'

/**
 * POST /api/tasks/[id]/join
 *
 * Agent 主动加入 Team 任务的某个 party（公开招募场景）
 *
 * Body: { partyRole: "party-b" }
 * 认证：Bearer token（Agent 专用）
 *
 * 前提条件：
 *   1. 任务为 team 模式
 *   2. 目标 partyRole 存在且步骤状态为 pending_invite（尚未绑定）
 *   3. 当前 Agent 未绑定此任务的任何步骤
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params

  // 仅支持 Bearer token 认证（Agent 调用）
  const tokenAuth = await authenticateRequest(req)
  if (!tokenAuth) {
    return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
  }
  const userId = tokenAuth.user.id

  const body = await req.json().catch(() => ({}))
  const partyRole: string | undefined = body.partyRole
  if (!partyRole) {
    return NextResponse.json({ error: '缺少 partyRole 字段' }, { status: 400 })
  }

  // 查任务
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, mode: true, workspaceId: true, status: true, title: true }
  })
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }
  if (task.mode !== 'team') {
    return NextResponse.json({ error: '该任务不是 Team 模式，无法以 party 身份加入' }, { status: 400 })
  }
  if (task.status === 'done' || task.status === 'cancelled') {
    return NextResponse.json({ error: '任务已结束，无法加入' }, { status: 400 })
  }

  // 查目标 partyRole 的待绑定步骤
  const pendingSteps = await prisma.taskStep.findMany({
    where: { taskId, partyRole, status: 'pending_invite' },
    select: { id: true, order: true, parallelGroup: true, status: true, assigneeId: true, title: true, stepType: true }
  })
  if (pendingSteps.length === 0) {
    // 已被占用或不存在此 party
    const anyStepWithRole = await prisma.taskStep.findFirst({
      where: { taskId, partyRole },
      select: { id: true, assigneeId: true }
    })
    if (!anyStepWithRole) {
      return NextResponse.json({ error: `任务中不存在 partyRole="${partyRole}" 的步骤` }, { status: 404 })
    }
    // 检查是否已是该 party 的成员
    const alreadyBound = await prisma.taskStep.findFirst({
      where: { taskId, partyRole, assigneeId: userId }
    })
    if (alreadyBound) {
      return NextResponse.json({ error: '你已经是该 party 的成员，无需重复加入' }, { status: 409 })
    }
    return NextResponse.json({ error: `partyRole="${partyRole}" 已被其他 Agent 占用` }, { status: 409 })
  }

  // 检查当前 Agent 是否已绑定此任务的其他步骤（防止一人占多方）
  const alreadyInTask = await prisma.taskStep.findFirst({
    where: { taskId, assigneeId: userId }
  })
  if (alreadyInTask) {
    return NextResponse.json({ error: '你已参与此任务的其他步骤，无法再以新 party 身份加入' }, { status: 409 })
  }

  // 加入工作区（已是成员则跳过）
  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId, workspaceId: task.workspaceId } },
    update: {},
    create: { userId, workspaceId: task.workspaceId, role: 'member', memberSource: 'task_join' }
  })

  // 绑定步骤：pending_invite → pending，设置 assigneeId
  await prisma.taskStep.updateMany({
    where: { id: { in: pendingSteps.map(s => s.id) } },
    data: {
      assigneeId: userId,
      unassigned: false,
      unassignedReason: null,
      status: 'pending',
    }
  })

  // 创建 StepAssignee 记录
  const userAgent = await prisma.agent.findUnique({ where: { userId }, select: { id: true } })
  for (const s of pendingSteps) {
    await prisma.stepAssignee.create({
      data: {
        stepId: s.id,
        userId,
        isPrimary: true,
        assigneeType: userAgent ? 'agent' : 'human',
      }
    }).catch(() => {}) // 忽略重复
  }

  // 激活可执行步骤（检查前序是否已完成）
  const allTaskSteps = await prisma.taskStep.findMany({
    where: { taskId },
    select: { id: true, order: true, parallelGroup: true, status: true, assigneeId: true, title: true, stepType: true }
  })
  const startable = getStartableSteps(allTaskSteps)
  await activateAndNotifySteps(taskId, startable)
  const activatedCount = startable.filter(s => pendingSteps.some(p => p.id === s.id)).length

  console.log(`[task/join] taskId=${taskId} partyRole=${partyRole} userId=${userId} → ${pendingSteps.length} 步骤绑定，${activatedCount} 个激活`)

  return NextResponse.json({
    success: true,
    message: `已成功以 ${partyRole} 身份加入任务`,
    taskId,
    taskTitle: task.title,
    partyRole,
    boundSteps: pendingSteps.length,
    activatedSteps: activatedCount,
  })
}

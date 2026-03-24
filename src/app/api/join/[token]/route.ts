import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { activateAndNotifySteps } from '@/lib/step-scheduling'

// GET /api/join/[token] — 查询邀请信息（未登录也可预览）
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: tokenParam } = await params
  const invite = await prisma.inviteToken.findUnique({
    where: { token: tokenParam },
    include: {
      inviter: { select: { id: true, name: true, avatar: true } },
      workspace: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, description: true, status: true } }
    }
  })

  if (!invite) return NextResponse.json({ error: '邀请链接无效' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: '邀请链接已过期' }, { status: 410 })
  if (invite.usedAt) return NextResponse.json({ error: '此邀请链接已被使用' }, { status: 410 })

  return NextResponse.json({
    valid: true,
    inviter: invite.inviter,
    workspace: invite.workspace,
    task: invite.task
  })
}

// POST /api/join/[token] — 接受邀请（需要登录）
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: tokenParam } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录后接受邀请', needLogin: true }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const invite = await prisma.inviteToken.findUnique({
    where: { token: tokenParam },
    include: { task: true }
  })

  if (!invite) return NextResponse.json({ error: '邀请链接无效' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: '邀请链接已过期' }, { status: 410 })
  if (invite.usedAt) return NextResponse.json({ error: '此邀请链接已被使用' }, { status: 410 })

  // 不能接受自己的邀请
  if (invite.inviterId === user.id) {
    return NextResponse.json({ error: '不能接受自己发出的邀请' }, { status: 400 })
  }

  // 加入工作区（如已是成员则跳过）
  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
    update: {},
    create: {
      userId: user.id,
      workspaceId: invite.workspaceId,
      role: 'member',
      memberSource: 'invite_link',
      addedByUserId: invite.inviterId,
    }
  })

  // 标记邀请已使用（同时记录 inviteeId）
  await prisma.inviteToken.update({
    where: { token: tokenParam },
    data: { usedAt: new Date(), inviteeId: user.id }
  })

  // Team 模版多方邀请：自动绑定 partyRole 步骤
  let activatedStepCount = 0
  if (invite.taskId && invite.partyRole) {
    const pendingSteps = await prisma.taskStep.findMany({
      where: {
        taskId: invite.taskId,
        partyRole: invite.partyRole,
        status: 'pending_invite',
      },
      select: { id: true, order: true, parallelGroup: true, status: true, assigneeId: true, title: true, stepType: true }
    })

    if (pendingSteps.length > 0) {
      // 绑定 assigneeId，改状态为 pending
      await prisma.taskStep.updateMany({
        where: { id: { in: pendingSteps.map(s => s.id) } },
        data: {
          assigneeId: user.id,
          unassigned: false,
          unassignedReason: null,
          status: 'pending',
        }
      })
      // 创建 StepAssignee 记录
      for (const s of pendingSteps) {
        const userAgent = await prisma.agent.findUnique({ where: { userId: user.id }, select: { id: true } })
        await prisma.stepAssignee.create({
          data: { stepId: s.id, userId: user.id, isPrimary: true, assigneeType: userAgent ? 'agent' : 'human' }
        }).catch(() => {})
      }

      // 激活可执行步骤（检查前序是否已完成）
      const allTaskSteps = await prisma.taskStep.findMany({
        where: { taskId: invite.taskId },
        select: { id: true, order: true, parallelGroup: true, status: true, assigneeId: true, title: true, stepType: true }
      })
      const { getStartableSteps } = await import('@/lib/step-scheduling')
      const startable = getStartableSteps(allTaskSteps)
      await activateAndNotifySteps(invite.taskId, startable)
      activatedStepCount = startable.filter(s => pendingSteps.some(p => p.id === s.id)).length
      console.log(`[join] partyRole=${invite.partyRole} → ${pendingSteps.length} 步骤绑定给 ${user.name}，${activatedStepCount} 个已激活`)
    }
  }

  return NextResponse.json({
    success: true,
    message: '已成功加入工作区！',
    taskId: invite.taskId,
    workspaceId: invite.workspaceId,
    ...(invite.partyRole ? { partyRole: invite.partyRole, activatedSteps: activatedStepCount } : {})
  })
}

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [
    totalUsers,
    totalAgents,
    onlineAgents,
    totalWorkspaces,
    totalTasks,
    tasksToday,
    doneTasks,
    totalSteps,
    doneSteps,
    pendingApproval,
    totalAttachments,
    recentActivity,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.agent.count(),
    prisma.agent.count({ where: { status: { in: ['online', 'working'] } } }),
    prisma.workspace.count(),
    prisma.task.count(),
    prisma.task.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.task.count({ where: { status: 'done' } }),
    prisma.taskStep.count(),
    prisma.taskStep.count({ where: { status: 'done' } }),
    prisma.taskStep.count({ where: { status: 'waiting_approval' } }),
    prisma.attachment.count(),
    // 近7天每天的任务数
    prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE("createdAt") as date, COUNT(*) as count
      FROM "Task"
      WHERE "createdAt" >= NOW() - INTERVAL '7 days'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,
  ])

  return NextResponse.json({
    users: { total: totalUsers },
    agents: { total: totalAgents, online: onlineAgents },
    workspaces: { total: totalWorkspaces },
    tasks: {
      total: totalTasks,
      today: tasksToday,
      done: doneTasks,
      doneRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    },
    steps: {
      total: totalSteps,
      done: doneSteps,
      pendingApproval,
    },
    attachments: { total: totalAttachments },
    activity: recentActivity.map(r => ({
      date: r.date,
      count: Number(r.count),
    })),
  })
}

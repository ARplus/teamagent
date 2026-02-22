import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top']

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const status = searchParams.get('status') // filter by status
  const skip = (page - 1) * limit

  const where = status ? { status } : {}

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        mode: true,
        createdAt: true,
        updatedAt: true,
        agentWorkRatio: true,
        creator: { select: { id: true, name: true, email: true } },
        workspace: { select: { id: true, name: true } },
        _count: { select: { steps: true } },
        steps: {
          select: { status: true },
        }
      }
    }),
    prisma.task.count({ where })
  ])

  return NextResponse.json({
    tasks: tasks.map(t => ({
      ...t,
      stepStats: {
        total: t._count.steps,
        done: t.steps.filter(s => s.status === 'done').length,
        pending: t.steps.filter(s => s.status === 'pending').length,
        inProgress: t.steps.filter(s => s.status === 'in_progress').length,
        waitingApproval: t.steps.filter(s => s.status === 'waiting_approval').length,
      },
      steps: undefined,
      _count: undefined,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}

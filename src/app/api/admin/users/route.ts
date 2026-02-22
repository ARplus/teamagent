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

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
          isMainAgent: true,
          capabilities: true,
          claimedAt: true,
          reputation: true,
        }
      },
      workspaces: {
        select: {
          role: true,
          workspace: { select: { id: true, name: true } }
        }
      },
      _count: {
        select: {
          createdTasks: true,
          taskSteps: true,
        }
      }
    }
  })

  return NextResponse.json({ users })
}

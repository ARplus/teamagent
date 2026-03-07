import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAdmin } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      creditBalance: true,
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
          apiTokens: true,
        }
      }
    }
  })

  return NextResponse.json({ users })
}

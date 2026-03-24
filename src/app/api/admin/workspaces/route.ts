import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

/**
 * GET /api/admin/workspaces — 列出所有工作区（管理员专用）
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const workspaces = await prisma.workspace.findMany({
      include: {
        _count: {
          select: { members: true, taskTemplates: true },
        },
        members: {
          where: { role: 'owner' },
          select: { user: { select: { id: true, name: true, email: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const result = workspaces.map(ws => ({
      id: ws.id,
      name: ws.name,
      description: ws.description,
      type: ws.type,
      orgType: ws.orgType,
      orgName: ws.orgName,
      memberCount: ws._count.members,
      courseCount: ws._count.taskTemplates,
      owner: ws.members[0]?.user || null,
      createdAt: ws.createdAt,
    }))

    return NextResponse.json({ workspaces: result })
  } catch (error) {
    console.error('[Admin/Workspaces] 失败:', error)
    return NextResponse.json({ error: '获取工作区列表失败' }, { status: 500 })
  }
}

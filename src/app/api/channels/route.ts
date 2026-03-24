/**
 * 频道 API
 * GET  /api/channels?workspaceId=xxx — 列出频道
 * POST /api/channels — 创建频道
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { ensureDefaultChannel, generateSlug } from '@/lib/channel-utils'

// 双认证（token + session）
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }
  return null
}

// GET /api/channels?workspaceId=xxx
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const workspaceId = req.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      // 如果没传 workspaceId，取用户的第一个工作区
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId },
        select: { workspaceId: true }
      })
      if (!membership) {
        return NextResponse.json({ error: '你还没有加入任何工作区' }, { status: 404 })
      }
      // 用找到的工作区
      const wsId = membership.workspaceId

      // 确保有默认频道
      await ensureDefaultChannel(wsId)

      const channels = await prisma.channel.findMany({
        where: { workspaceId: wsId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: {
          _count: { select: { messages: true } }
        }
      })

      return NextResponse.json({ workspaceId: wsId, channels })
    }

    // 校验工作区成员资格（广场对所有认证用户开放）
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { type: true } })
    if (ws?.type !== 'plaza') {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: auth.userId, workspaceId }
        }
      })
      if (!member) {
        return NextResponse.json({ error: '你不是该工作区的成员' }, { status: 403 })
      }
    }

    // 确保有默认频道（懒迁移）
    await ensureDefaultChannel(workspaceId)

    const channels = await prisma.channel.findMany({
      where: { workspaceId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { messages: true } }
      }
    })

    return NextResponse.json({ workspaceId, channels })

  } catch (error) {
    console.error('获取频道列表失败:', error)
    return NextResponse.json({ error: '获取频道列表失败' }, { status: 500 })
  }
}

// POST /api/channels — 创建频道（仅 admin/owner）
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { workspaceId, name, description } = await req.json()

    if (!workspaceId || !name) {
      return NextResponse.json({ error: '缺少 workspaceId 或 name' }, { status: 400 })
    }

    // 校验权限（admin/owner 可创建）
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId: auth.userId, workspaceId }
      }
    })
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return NextResponse.json({ error: '只有管理员可以创建频道' }, { status: 403 })
    }

    const slug = generateSlug(name)

    // 检查 slug 冲突
    const existing = await prisma.channel.findUnique({
      where: { workspaceId_slug: { workspaceId, slug } }
    })
    if (existing) {
      return NextResponse.json({ error: '频道名称已存在' }, { status: 409 })
    }

    const channel = await prisma.channel.create({
      data: {
        workspaceId,
        name,
        slug,
        description: description || null,
      }
    })

    return NextResponse.json(channel)

  } catch (error) {
    console.error('创建频道失败:', error)
    return NextResponse.json({ error: '创建频道失败' }, { status: 500 })
  }
}

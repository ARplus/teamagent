/**
 * 日程事件 API
 * GET  /api/schedule — 获取日程列表
 * POST /api/schedule — 创建日程
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET: 获取日程列表
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from') // ISO date
  const to = url.searchParams.get('to')     // ISO date
  const status = url.searchParams.get('status') || 'active'

  const where: any = {
    userId: session.user.id,
    status,
  }

  if (from || to) {
    where.startAt = {}
    if (from) where.startAt.gte = new Date(from)
    if (to) where.startAt.lte = new Date(to)
  }

  const events = await prisma.scheduleEvent.findMany({
    where,
    orderBy: { startAt: 'asc' },
    take: 200,
    include: {
      task: { select: { id: true, title: true, status: true } },
    },
  })

  return NextResponse.json({ events })
}

// POST: 创建日程
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const body = await req.json()
  const { title, description, emoji, startAt, endAt, allDay, remindAt, color, taskId, source, voiceText, recurring } = body

  if (!title || !startAt) {
    return NextResponse.json({ error: '缺少 title 或 startAt' }, { status: 400 })
  }

  const event = await prisma.scheduleEvent.create({
    data: {
      userId: session.user.id,
      title,
      description: description || null,
      emoji: emoji || '📅',
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      allDay: allDay || false,
      remindAt: remindAt ? new Date(remindAt) : null,
      color: color || 'orange',
      taskId: taskId || null,
      source: source || 'manual',
      voiceText: voiceText || null,
      recurring: recurring || null,
    },
  })

  return NextResponse.json({ event }, { status: 201 })
}

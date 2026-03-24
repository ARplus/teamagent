/**
 * 单个日程事件 API
 * GET    /api/schedule/[id] — 获取单条
 * PATCH  /api/schedule/[id] — 更新
 * DELETE /api/schedule/[id] — 删除（标记 cancelled）
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

// GET: 获取单条日程
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const { id } = await params
  const event = await prisma.scheduleEvent.findFirst({
    where: { id, userId: session.user.id },
    include: { task: { select: { id: true, title: true, status: true } } },
  })

  if (!event) {
    return NextResponse.json({ error: '日程不存在' }, { status: 404 })
  }

  return NextResponse.json({ event })
}

// PATCH: 更新日程
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.scheduleEvent.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: '日程不存在' }, { status: 404 })
  }

  const body = await req.json()
  const data: any = {}

  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description
  if (body.emoji !== undefined) data.emoji = body.emoji
  if (body.startAt !== undefined) data.startAt = new Date(body.startAt)
  if (body.endAt !== undefined) data.endAt = body.endAt ? new Date(body.endAt) : null
  if (body.allDay !== undefined) data.allDay = body.allDay
  if (body.remindAt !== undefined) {
    data.remindAt = body.remindAt ? new Date(body.remindAt) : null
    data.reminded = false // reset reminder when changing time
  }
  if (body.color !== undefined) data.color = body.color
  if (body.status !== undefined) data.status = body.status
  if (body.recurring !== undefined) data.recurring = body.recurring

  const event = await prisma.scheduleEvent.update({
    where: { id },
    data,
  })

  return NextResponse.json({ event })
}

// DELETE: 取消日程（soft delete）
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.scheduleEvent.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: '日程不存在' }, { status: 404 })
  }

  await prisma.scheduleEvent.update({
    where: { id },
    data: { status: 'cancelled' },
  })

  return NextResponse.json({ ok: true })
}

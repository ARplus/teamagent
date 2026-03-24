import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

// GET /api/admin/courses/[id] — 获取课程详情（含 stepsTemplate）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    const { id } = await params
    const course = await prisma.taskTemplate.findUnique({
      where: { id },
      select: {
        id: true, name: true, icon: true, description: true,
        courseType: true, stepsTemplate: true, price: true,
        reviewStatus: true, reviewNote: true, isPublic: true,
        creator: { select: { name: true, email: true } },
      },
    })
    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }
    let steps: any[] = []
    try { steps = JSON.parse(course.stepsTemplate || '[]') } catch {}
    return NextResponse.json({ ...course, steps })
  } catch (error) {
    console.error('[Admin/Courses/GET] 失败:', error)
    return NextResponse.json({ error: '获取失败' }, { status: 500 })
  }
}

// PATCH /api/admin/courses/[id] — 管理员审核课程
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { action, note } = body // action: approve | reject | takedown | restore

    if (!['approve', 'reject', 'takedown', 'restore'].includes(action)) {
      return NextResponse.json({ error: '无效操作' }, { status: 400 })
    }

    const template = await prisma.taskTemplate.findUnique({ where: { id } })
    if (!template || !template.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }

    const updateData: any = {}

    if (action === 'approve') {
      updateData.reviewStatus = 'approved'
      updateData.reviewNote = note || null
      updateData.isPublic = true
      updateData.isDraft = false
      updateData.isEnabled = true
    } else if (action === 'reject') {
      updateData.reviewStatus = 'rejected'
      updateData.reviewNote = note || null
    } else if (action === 'takedown') {
      // 下架：保留 approved 状态，但隐藏
      updateData.isPublic = false
      updateData.isEnabled = false
      updateData.reviewNote = note || '已被管理员下架'
    } else if (action === 'restore') {
      // 恢复上架
      updateData.isPublic = true
      updateData.isEnabled = true
      updateData.reviewNote = null
    }

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        reviewStatus: true,
        reviewNote: true,
        isPublic: true,
        isEnabled: true,
      },
    })

    console.log(`[Admin/Courses] ${action} 课程 "${template.name}" (${id})`)

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Admin/Courses/PATCH] 失败:', error)
    return NextResponse.json({ error: '审核操作失败' }, { status: 500 })
  }
}

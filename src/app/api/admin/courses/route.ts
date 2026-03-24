import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

// GET /api/admin/courses — 管理员获取课程审核列表
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending' // pending | approved | rejected | takedown | all

    const where: any = {
      courseType: { not: null },
    }

    if (status === 'takedown') {
      // 下架的课程：已通过但被隐藏
      where.reviewStatus = 'approved'
      where.isPublic = false
    } else if (status !== 'all') {
      where.reviewStatus = status
    }

    const courses = await prisma.taskTemplate.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        category: true,
        courseType: true,
        price: true,
        coverImage: true,
        reviewStatus: true,
        reviewNote: true,
        isPublic: true,
        isDraft: true,
        isEnabled: true,
        createdAt: true,
        updatedAt: true,
        stepsTemplate: true,
        creator: { select: { id: true, name: true, email: true, avatar: true } },
        workspace: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // 计算步骤数
    const result = courses.map(c => {
      let stepsCount = 0
      try {
        const steps = JSON.parse(c.stepsTemplate)
        stepsCount = Array.isArray(steps) ? steps.length : 0
      } catch {}
      const { stepsTemplate, ...rest } = c
      return { ...rest, stepsCount }
    })

    return NextResponse.json({ courses: result })
  } catch (error) {
    console.error('[Admin/Courses/GET] 失败:', error)
    return NextResponse.json({ error: '获取课程列表失败' }, { status: 500 })
  }
}

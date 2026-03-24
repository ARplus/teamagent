import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/my-created-courses — 我创建的课程（所有状态）
 *
 * 返回当前用户创建的所有课程模板（草稿、审核中、已上线、被驳回）
 * 需要登录（Session 或 Bearer Token）
 */
export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null

    // 支持 Bearer Token 认证
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
    }

    // 回退到 Session 认证
    if (!userId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
        userId = user?.id || null
      }
    }

    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 查找当前用户创建的、courseType 不为空的模板（即课程）
    const courses = await prisma.taskTemplate.findMany({
      where: {
        creatorId: userId,
        courseType: { not: null },
      },
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const result = courses.map(c => {
      let stepsCount = 0
      try {
        const steps = JSON.parse(c.stepsTemplate)
        stepsCount = Array.isArray(steps) ? steps.length : 0
      } catch {}

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        courseType: c.courseType,
        price: c.price,
        coverImage: c.coverImage,
        isDraft: c.isDraft,
        isPublic: c.isPublic,
        reviewStatus: c.reviewStatus,
        reviewNote: c.reviewNote,
        stepsCount,
        enrollCount: c._count.enrollments,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }
    })

    return NextResponse.json({ courses: result })
  } catch (error) {
    console.error('[Academy/MyCreatedCourses] 失败:', error)
    return NextResponse.json({ error: '获取创建课程失败' }, { status: 500 })
  }
}

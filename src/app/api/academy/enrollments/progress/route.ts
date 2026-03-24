import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    if (user) return { userId: user.id }
  }
  return null
}

/**
 * PATCH /api/academy/enrollments/progress — 更新学习进度
 *
 * Body: { enrollmentId: string, completedSteps: number[] }
 *
 * 更新 CourseEnrollment 的 completedSteps、progress、status
 * 适用于所有课程类型（human课程必需，agent课程也可用）
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body = await req.json()
    const { enrollmentId, completedSteps } = body

    if (!enrollmentId || !Array.isArray(completedSteps)) {
      return NextResponse.json({ error: '缺少 enrollmentId 或 completedSteps' }, { status: 400 })
    }

    // 查找报名记录（必须是当前用户的）
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { id: enrollmentId, userId: auth.userId },
      include: {
        template: {
          select: { stepsTemplate: true },
        },
      },
    })

    if (!enrollment) {
      return NextResponse.json({ error: '报名记录不存在' }, { status: 404 })
    }

    // 计算进度
    let totalSteps = 0
    try {
      const steps = JSON.parse(enrollment.template.stepsTemplate)
      totalSteps = Array.isArray(steps) ? steps.length : 0
    } catch {}

    const progress = totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0
    const isComplete = progress >= 100

    // 更新
    const updated = await prisma.courseEnrollment.update({
      where: { id: enrollmentId },
      data: {
        completedSteps: JSON.stringify(completedSteps),
        progress: Math.min(progress, 100),
        status: isComplete ? 'completed' : completedSteps.length > 0 ? 'learning' : 'enrolled',
        completedAt: isComplete ? new Date() : null,
      },
    })

    return NextResponse.json({
      progress: updated.progress,
      status: updated.status,
      completedSteps,
    })
  } catch (error) {
    console.error('[Academy/Progress] 失败:', error)
    return NextResponse.json({ error: '更新进度失败' }, { status: 500 })
  }
}

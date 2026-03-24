import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/academy/certificate?enrollmentId=xxx
 *
 * 获取结课证书数据（JSON，前端渲染）
 * 需要登录 + 课程已完成
 */
export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null

    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) userId = tokenAuth.user.id

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

    const { searchParams } = new URL(req.url)
    const enrollmentId = searchParams.get('enrollmentId')
    if (!enrollmentId) {
      return NextResponse.json({ error: '缺少 enrollmentId' }, { status: 400 })
    }

    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { id: enrollmentId, userId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        template: {
          select: {
            id: true,
            name: true,
            icon: true,
            courseType: true,
            school: true,
            department: true,
            stepsTemplate: true,
            examTemplate: true,
            creator: { select: { name: true, agent: { select: { name: true } } } },
          },
        },
      },
    })

    if (!enrollment) {
      return NextResponse.json({ error: '未找到报名记录' }, { status: 404 })
    }

    if (enrollment.progress < 100) {
      return NextResponse.json({ error: '课程未完成，无法获取证书' }, { status: 403 })
    }

    // 检查考试：有考试的课程必须通过才能拿证书
    let examScore: number | null = null
    let examMaxScore: number | null = null
    if (enrollment.template.examTemplate) {
      const examSubmission = await prisma.examSubmission.findUnique({
        where: { enrollmentId },
        select: { passed: true, totalScore: true, maxScore: true, gradingStatus: true },
      })
      if (!examSubmission || !examSubmission.passed) {
        return NextResponse.json({ error: '考试未通过，无法获取证书' }, { status: 403 })
      }
      examScore = examSubmission.totalScore
      examMaxScore = examSubmission.maxScore
    }

    // 计算课时数
    let stepsCount = 0
    try {
      const steps = JSON.parse(enrollment.template.stepsTemplate)
      stepsCount = Array.isArray(steps) ? steps.length : 0
    } catch {}

    // 生成证书编号（基于 enrollmentId 的确定性编号）
    const certNumber = `LA-${enrollment.id.slice(-8).toUpperCase()}`

    return NextResponse.json({
      certificate: {
        certNumber,
        studentName: enrollment.user.name || '学员',
        courseName: enrollment.template.name,
        courseIcon: enrollment.template.icon,
        courseType: enrollment.template.courseType,
        school: enrollment.template.school || null,
        department: enrollment.template.department || null,
        examScore,
        examMaxScore,
        stepsCount,
        instructorName: enrollment.template.creator?.name || null,
        instructorAgentName: enrollment.template.creator?.agent?.name || null,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        issuedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('[Academy/Certificate] 失败:', error)
    return NextResponse.json({ error: '获取证书失败' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * PATCH /api/academy/courses/[id]/exam
 * 提交 / 更新课程考试模板（支持 API Token，供 Agent 调用）
 * Body: { examTemplate: string | object, examPassScore?: number }
 *
 * - 仅课程创建者可操作
 * - examTemplate 可以是 JSON 字符串或对象（会自动序列化）
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 双轨鉴权
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
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    // 验证课程存在 + 权限
    const course = await prisma.taskTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, creatorId: true, courseType: true },
    })
    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }
    if (course.creatorId !== userId) {
      return NextResponse.json({ error: '只有课程创建者可以更新考试模板' }, { status: 403 })
    }

    const body = await req.json()
    const { examTemplate, examPassScore, principleTemplate } = body

    if (!examTemplate && principleTemplate === undefined) {
      return NextResponse.json({ error: '缺少 examTemplate 或 principleTemplate' }, { status: 400 })
    }

    // examTemplate 可以是对象或字符串（不传则跳过）
    let examJson: string | undefined
    if (typeof examTemplate === 'string') {
      // 验证是否合法 JSON
      try {
        const parsed = JSON.parse(examTemplate)
        if (!parsed.questions && !parsed.pairs) {
          return NextResponse.json(
            { error: 'examTemplate 必须包含 questions 或 pairs 字段' },
            { status: 400 }
          )
        }
        examJson = examTemplate
      } catch {
        return NextResponse.json({ error: 'examTemplate 不是合法 JSON' }, { status: 400 })
      }
    } else if (typeof examTemplate === 'object') {
      if (!examTemplate.questions && !examTemplate.pairs) {
        return NextResponse.json(
          { error: 'examTemplate 必须包含 questions 或 pairs 字段' },
          { status: 400 }
        )
      }
      examJson = JSON.stringify(examTemplate)
    } else {
      return NextResponse.json({ error: 'examTemplate 格式错误' }, { status: 400 })
    }

    // 更新
    const examUpdateData: Record<string, any> = {}
    if (examJson) examUpdateData.examTemplate = examJson
    if (examPassScore !== undefined) examUpdateData.examPassScore = Number(examPassScore)
    if (principleTemplate !== undefined) examUpdateData.principleTemplate = typeof principleTemplate === 'string' ? principleTemplate : JSON.stringify(principleTemplate)

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data: examUpdateData,
      select: { id: true, name: true, examPassScore: true },
    })

    // 改及格分后：重算所有已批改 submission 的 passed 状态
    if (examPassScore !== undefined) {
      const newPassScore = Number(examPassScore)
      const submissions = await prisma.examSubmission.findMany({
        where: { templateId: id, gradingStatus: 'graded', totalScore: { not: null } },
        select: { id: true, totalScore: true, maxScore: true, passed: true, enrollmentId: true },
      })
      let recalculated = 0
      for (const sub of submissions) {
        const newPassed = sub.totalScore !== null && sub.maxScore > 0
          ? (sub.totalScore / sub.maxScore * 100) >= newPassScore
          : false
        if (newPassed !== sub.passed) {
          await prisma.examSubmission.update({
            where: { id: sub.id },
            data: { passed: newPassed },
          })
          // 同步更新 enrollment 状态
          await prisma.courseEnrollment.update({
            where: { id: sub.enrollmentId },
            data: { status: newPassed ? 'graduated' : 'learning' },
          })
          recalculated++
        }
      }
      if (recalculated > 0) {
        console.log(`[Academy/Exam] 及格分改为 ${newPassScore}，重算 ${recalculated} 份已提交试卷`)
      }
    }

    console.log(`[Academy/Exam] ${userId} 更新课程「${course.name}」考试模板`)

    return NextResponse.json({
      success: true,
      courseId: updated.id,
      courseName: updated.name,
      examPassScore: updated.examPassScore,
      message: `「${updated.name}」考试模板已更新 ✅`,
    })
  } catch (error) {
    console.error('[Academy/Course/Exam] 失败:', error)
    return NextResponse.json({ error: '更新考试模板失败' }, { status: 500 })
  }
}

/**
 * GET /api/academy/courses/[id]/exam
 * 查看课程考试模板（供创建者查阅）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const course = await prisma.taskTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, creatorId: true, courseType: true, examTemplate: true, examPassScore: true },
    })
    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }
    if (course.creatorId !== userId) {
      return NextResponse.json({ error: '只有课程创建者可以查看考试模板' }, { status: 403 })
    }

    return NextResponse.json({
      courseId: course.id,
      courseName: course.name,
      examPassScore: course.examPassScore,
      examTemplate: course.examTemplate ? JSON.parse(course.examTemplate) : null,
      hasExam: !!course.examTemplate,
    })
  } catch (error) {
    console.error('[Academy/Course/Exam/GET] 失败:', error)
    return NextResponse.json({ error: '获取考试模板失败' }, { status: 500 })
  }
}

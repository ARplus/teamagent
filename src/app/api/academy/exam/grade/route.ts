import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'

/**
 * PATCH /api/academy/exam/grade
 * 创建者批改主观题
 * Body: { submissionId, grades: [{ questionId, manualScore, feedback }], gradingNote? }
 */
export async function PATCH(req: NextRequest) {
  try {
    let userId: string | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) userId = tokenAuth.user.id
    if (!userId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
        userId = user?.id || null
      }
    }
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const body = await req.json()
    const { submissionId, grades, gradingNote } = body
    if (!submissionId || !grades || !Array.isArray(grades)) {
      return NextResponse.json({ error: '缺少 submissionId 或 grades' }, { status: 400 })
    }

    // 验证是课程创建者 或 工作区管理员/Owner
    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        template: { select: { id: true, name: true, creatorId: true, workspaceId: true, examPassScore: true, examTemplate: true, principleTemplate: true } },
      },
    })
    if (!submission) return NextResponse.json({ error: '未找到考试记录' }, { status: 404 })

    const isCreator = submission.template.creatorId === userId
    const isAdmin = await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: submission.template.workspaceId, role: { in: ['owner', 'admin'] } },
      select: { id: true }
    })
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: '只有课程创建者或工作区管理员可以批改' }, { status: 403 })
    }

    // 合并人工评分到 answers
    const answers = JSON.parse(submission.answers || '[]')
    let manualScore = 0
    for (const grade of grades) {
      const ans = answers.find((a: any) => a.questionId === grade.questionId)
      if (ans) {
        ans.manualScore = grade.manualScore || 0
        ans.feedback = grade.feedback || ''
        manualScore += grade.manualScore || 0
      }
    }

    const totalScore = (submission.autoScore || 0) + manualScore
    const maxScore = submission.maxScore || 100

    let passScore = submission.template.examPassScore || 60
    try {
      const exam = JSON.parse(submission.template.examTemplate || '{}')
      if (exam.passScore) passScore = exam.passScore
    } catch {}

    const passed = (totalScore / maxScore * 100) >= passScore

    const updated = await prisma.examSubmission.update({
      where: { id: submissionId },
      data: {
        answers: JSON.stringify(answers),
        manualScore,
        totalScore,
        passed,
        gradingStatus: 'graded',
        gradedBy: userId,
        gradingNote: gradingNote || null,
      },
    })

    // 查创建者 Agent（供通知用，hoisted 到此处供下面多处复用）
    const creatorAgent = await prisma.agent.findFirst({
      where: { userId: userId },
      select: { id: true, name: true },
    })

    // 通过 → 自动升级 enrollment + 下发 Principle
    if (passed) {
      const now = new Date()
      const principleTemplate = submission.template.principleTemplate

      // 替换 Principle 模板变量（注入课程名、结业日期）
      let principleContent = principleTemplate?.trim() || null
      if (principleContent) {
        principleContent = principleContent
          .replace(/\{courseName\}/g, submission.template.name)
          .replace(/\{graduatedAt\}/g, now.toISOString().slice(0, 10))
      }

      await prisma.courseEnrollment.update({
        where: { id: submission.enrollmentId },
        data: {
          status: 'graduated',
          principleDelivered: !!principleContent,
          principleDeliveredAt: principleContent ? now : null,
        },
      })

      // 下发 Principle：SSE + Chat 消息（Skill 收到后 append 到本地百宝箱.md）
      if (principleContent && creatorAgent) {
        const principleChat = `📦 【新技能解锁】课程《${submission.template.name}》结业！\n\n以下 Principle 已自动写入你的百宝箱.md：\n\n${principleContent}\n\n---\n_龙虾学院 · ${now.toISOString().slice(0, 10)}_`
        const principleMsg = await prisma.chatMessage.create({
          data: {
            content: principleChat,
            role: 'agent',
            userId: submission.userId,
            agentId: creatorAgent.id,
          },
        })
        // SSE principle:received — Skill 监听此事件写入三层文件
        let principleData: any = null
        try {
          const parsed = JSON.parse(principleContent)
          if (parsed.coreInsight || parsed.keyPrinciples) principleData = parsed
        } catch {
          principleData = { coreInsight: `完成课程「${submission.template.name}」`, keyPrinciples: [principleContent], forbiddenList: [], checklist: [] }
        }
        sendToUser(submission.userId, {
          type: 'principle:received',
          enrollmentId: submission.enrollmentId,
          courseName: submission.template.name,
          principleTemplate: principleData,
        })
        // chat:incoming 确保前端 Chat 面板也弹出通知
        sendToUser(submission.userId, {
          type: 'chat:incoming',
          msgId: principleMsg.id,
          content: principleChat.substring(0, 120),
          agentId: creatorAgent.id,
          agentName: creatorAgent.name,
          fromAgent: true,
        } as any)
      }
    }

    // SSE 通知学生考试结果
    sendToUser(submission.userId, {
      type: 'exam:graded' as any,
      enrollmentId: submission.enrollmentId,
      submissionId,
      courseName: submission.template.name,
      totalScore,
      maxScore,
      passed,
    })
    if (creatorAgent) {
      const resultEmoji = passed ? '🎉' : '📋'
      const resultText = passed ? `恭喜通过！得分 ${totalScore}/${maxScore}` : `本次未通过，得分 ${totalScore}/${maxScore}，继续加油`
      const chatContent = `${resultEmoji} 【考试批改完成】课程《${submission.template.name}》\n${resultText}${gradingNote ? `\n\n阅卷备注：${gradingNote}` : ''}`
      const chatMsg = await prisma.chatMessage.create({
        data: {
          content: chatContent,
          role: 'agent',
          userId: submission.userId,
          agentId: creatorAgent.id,
        },
      })
      sendToUser(submission.userId, {
        type: 'chat:incoming',
        msgId: chatMsg.id,
        content: chatContent.substring(0, 100),
        agentId: creatorAgent.id,
        agentName: creatorAgent.name,
        fromAgent: true,
      } as any)
    }

    return NextResponse.json({
      submission: {
        id: updated.id,
        totalScore,
        maxScore,
        passed,
        gradingStatus: 'graded',
      },
    })
  } catch (error) {
    console.error('[Academy/Exam/Grade] 失败:', error)
    return NextResponse.json({ error: '批改失败' }, { status: 500 })
  }
}

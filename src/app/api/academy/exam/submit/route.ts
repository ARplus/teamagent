import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { createNotification } from '@/lib/notifications'
import { generateMatchReport, type CollabExamTemplate } from '@/lib/collab-exam'

/**
 * POST /api/academy/exam/submit
 * 提交考试答案（自动批改客观题）
 * Body: { enrollmentId, answers: [{ questionId, answer }] }
 */
export async function POST(req: NextRequest) {
  try {
    let userId: string | null = null
    let isAgentClient = false  // true = 通过 API token 认证（Agent 客户端），false = 浏览器 Session（人类）
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) { userId = tokenAuth.user.id; isAgentClient = true }
    if (!userId) {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
        userId = user?.id || null
      }
    }
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const body = await req.json()
    const { enrollmentId, answers } = body
    if (!enrollmentId || !answers || !Array.isArray(answers)) {
      return NextResponse.json({ error: '缺少 enrollmentId 或 answers' }, { status: 400 })
    }

    // 查 enrollment + template
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { id: enrollmentId, userId },
      include: {
        template: { select: { id: true, name: true, examTemplate: true, examPassScore: true, creatorId: true, courseType: true } },
        examSubmission: { select: { id: true } },
      },
    })
    if (!enrollment) return NextResponse.json({ error: '未找到报名记录' }, { status: 404 })
    if (!enrollment.template.examTemplate) return NextResponse.json({ error: '该课程没有考试' }, { status: 400 })

    // 跨类型考试校验：人类不能考 Agent 课程，Agent 不能考人类课程
    // ⚠️ 注意：判断依据是【鉴权方式】，不是 user.agent 字段（所有人类用户也有 agent）
    //   isAgentClient=true  → API token 认证 = Agent 客户端（Watch 调用）
    //   isAgentClient=false → Session 认证 = 人类浏览器
    const courseType = enrollment.template.courseType || 'human'
    if (courseType === 'agent' && !isAgentClient) {
      return NextResponse.json({ error: '这是 Agent 课程，人类学员不可参加考试（可以学习）' }, { status: 403 })
    }
    if (courseType === 'human' && isAgentClient) {
      return NextResponse.json({ error: '这是人类课程，Agent 学员不可参加考试（可以学习）' }, { status: 403 })
    }

    // 解析考试定义
    let exam: { passScore?: number; questions: any[] }
    try {
      exam = JSON.parse(enrollment.template.examTemplate)
    } catch {
      return NextResponse.json({ error: '考试数据异常' }, { status: 500 })
    }

    const passScore = enrollment.template.examPassScore || exam.passScore || 60
    // 兼容字段别名：score→points, question→title, single→single_choice, multiple→multi_choice
    const questions = (exam.questions || []).map((q: any) => ({
      ...q,
      points: q.points ?? q.score ?? 0,
      title: q.title ?? q.question ?? '',
      type: q.type === 'single' ? 'single_choice' : q.type === 'multiple' ? 'multi_choice' : q.type,
    }))

    // 自动批改客观题
    let autoScore = 0
    let hasSubjective = false
    const maxScore = questions.reduce((sum: number, q: any) => sum + (q.points || 0), 0) || 100

    const gradedAnswers = answers.map((ans: any, ansIdx: number) => {
      // 兼容多种题目 ID 字段：id / questionId / qId，以及按 index 兜底
      const q = questions.find((q: any) =>
        (q.id && q.id === ans.questionId) ||
        (q.questionId && q.questionId === ans.questionId) ||
        (q.qId && q.qId === ans.questionId)
      ) || (typeof ans.questionId === 'number' ? questions[ans.questionId - 1] : null)
        || questions[ansIdx]  // 最终兜底：按提交顺序匹配
      if (!q) return { ...ans, autoScore: 0 }

      if (q.type === 'single_choice' || q.type === 'single') {
        // 容错：只比较首字母（A/B/C/D），兼容「C」和「C. 全文」两种存储格式
        const normalize = (v: unknown) => String(v ?? '').trim().charAt(0).toUpperCase()
        const correct = normalize(ans.answer) === normalize(q.correctAnswer)
        const score = correct ? (q.points || 0) : 0
        autoScore += score
        return { ...ans, autoScore: score }
      }
      if (q.type === 'multi_choice' || q.type === 'multiple') {
        const normalizeOpt = (v: unknown) => String(v ?? '').trim().charAt(0).toUpperCase()
        const userAns = (Array.isArray(ans.answer) ? ans.answer : [ans.answer]).map(normalizeOpt).filter(Boolean).sort()
        const correctAns = (Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]).map(normalizeOpt).filter(Boolean).sort()
        const correct = JSON.stringify(userAns) === JSON.stringify(correctAns)
        const score = correct ? (q.points || 0) : 0
        autoScore += score
        return { ...ans, autoScore: score }
      }
      // 主观题：short_answer, essay, practical_upload
      hasSubjective = true
      return { ...ans, autoScore: null }
    })

    const gradingStatus = hasSubjective ? 'manual_grading' : 'graded'
    const totalScore = hasSubjective ? null : autoScore
    const passed = hasSubjective ? false : (autoScore / maxScore * 100) >= passScore

    // upsert — 支持无限重考（覆盖上一次）
    const submission = await prisma.examSubmission.upsert({
      where: { enrollmentId },
      create: {
        enrollmentId,
        userId,
        templateId: enrollment.template.id,
        answers: JSON.stringify(gradedAnswers),
        autoScore,
        manualScore: null,
        totalScore,
        maxScore,
        passed,
        gradingStatus,
        submittedAt: new Date(),
      },
      update: {
        answers: JSON.stringify(gradedAnswers),
        autoScore,
        manualScore: null,
        totalScore,
        maxScore,
        passed,
        gradingStatus,
        gradedBy: null,
        gradingNote: null,
        complaintText: null,
        complaintStatus: null,
        complaintNote: null,
        submittedAt: new Date(),
      },
    })

    // 纯客观题且通过 → 自动升级 enrollment 状态 + 下发 Principle
    if (passed && !hasSubjective) {
      await prisma.courseEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'graduated' },
      })

      // 🆕 Principle 三层下发：通知学员 Agent 写入 SOUL/principles/method
      const fullCourse = await prisma.taskTemplate.findUnique({
        where: { id: enrollment.template.id },
        select: { principleTemplate: true, name: true },
      })
      if (fullCourse?.principleTemplate) {
        // 解析 principleTemplate（支持 JSON 结构和纯文本）
        let principleData: any = null
        try {
          const parsed = typeof fullCourse.principleTemplate === 'string'
            ? JSON.parse(fullCourse.principleTemplate)
            : fullCourse.principleTemplate
          if (parsed.coreInsight || parsed.keyPrinciples || parsed.checklist) {
            principleData = parsed // 结构化 JSON 格式
          }
        } catch {
          // 纯文本格式：包装为结构化
          principleData = {
            coreInsight: `完成课程「${fullCourse.name}」的核心认知`,
            keyPrinciples: [fullCourse.principleTemplate],
            forbiddenList: [],
            checklist: [],
          }
        }

        if (principleData) {
          // 发给学员 Agent（学员自己的 userId）
          sendToUser(userId, {
            type: 'principle:received' as any,
            enrollmentId,
            courseName: fullCourse.name,
            principleTemplate: principleData,
          })
          // 标记已下发
          await prisma.courseEnrollment.update({
            where: { id: enrollmentId },
            data: { principleDelivered: true, principleDeliveredAt: new Date() },
          })
          console.log(`[Principle] 已下发给学员 userId=${userId}，课程「${fullCourse.name}」`)
        }
      }
    }

    // 通知创建者（SSE + 持久通知双保险）
    // hasSubjective=true → 需要人工批改；false → 客观题自动批改，仍需告知结果
    {
      const student = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, agent: { select: { name: true } } }
      })
      const studentName = (student as any)?.agent?.name || student?.name || '学员'

      if (hasSubjective) {
        // 主观题：通知需要人工批改
        sendToUser(enrollment.template.creatorId, {
          type: 'exam:needs-grading' as any,
          enrollmentId,
          submissionId: submission.id,
          templateId: enrollment.template.id,
          courseName: enrollment.template.name,
          studentName,
        })
        await createNotification({
          userId: enrollment.template.creatorId,
          type: 'exam_grading',
          title: '📝 有考试需要批改',
          content: `${studentName} 提交了「${enrollment.template.name}」的考试，含主观题需要批改`,
        }).catch(e => console.warn('[Exam] 创建持久通知失败:', e.message))
      } else {
        // 纯客观题：自动批改完毕，通知创建者查看结果
        const resultText = passed ? `✅ 通过（${autoScore}/${maxScore}）` : `❌ 未通过（${autoScore}/${maxScore}）`
        sendToUser(enrollment.template.creatorId, {
          type: 'exam:needs-grading' as any,
          enrollmentId,
          submissionId: submission.id,
          templateId: enrollment.template.id,
          courseName: enrollment.template.name,
          studentName,
          autoGraded: true,
          passed,
          score: `${autoScore}/${maxScore}`,
        })
        await createNotification({
          userId: enrollment.template.creatorId,
          type: 'exam_grading',
          title: `📊 考试结果：${studentName}`,
          content: `「${enrollment.template.name}」— ${resultText}（客观题已自动批改）`,
        }).catch(e => console.warn('[Exam] 创建持久通知失败:', e.message))
      }
    }

    // ── 人机共学：双方都提交后生成匹配报告 ──────────────────────
    const fullTemplate = await prisma.taskTemplate.findUnique({
      where: { id: enrollment.template.id },
      select: { courseType: true, examTemplate: true },
    })
    let matchReport: any = null
    let waitingForPartner = false

    if (fullTemplate?.courseType === 'both' && fullTemplate.examTemplate) {
      try {
        const examDef = JSON.parse(fullTemplate.examTemplate)
        if (examDef.type === 'collab') {
          // 查找搭档提交（同课程、不同用户、尚未匹配）
          const partnerSub = await prisma.examSubmission.findFirst({
            where: {
              templateId: enrollment.template.id,
              userId: { not: userId },
              matchReport: null,
            },
          })

          if (partnerSub) {
            // 判断哪方是人类哪方是 Agent（用 isAgentClient，鉴权方式更准确）
            const myIsAgent = isAgentClient
            const humanAnswersRaw = myIsAgent
              ? JSON.parse(partnerSub.answers)
              : gradedAnswers
            const agentAnswersRaw = myIsAgent
              ? gradedAnswers
              : JSON.parse(partnerSub.answers)

            // 生成匹配报告
            console.log(`[CollabExam] 双方已提交，生成匹配报告 (templateId=${enrollment.template.id})`)
            matchReport = await generateMatchReport(
              humanAnswersRaw.map((a: any) => ({ questionId: a.questionId, answer: a.answer })),
              agentAnswersRaw.map((a: any) => ({ questionId: a.questionId, answer: a.answer })),
              examDef as CollabExamTemplate
            )
            const reportJson = JSON.stringify(matchReport)

            // 双方都存上报告
            await prisma.$transaction([
              prisma.examSubmission.update({
                where: { id: submission.id },
                data: { matchReport: reportJson, matchedWith: partnerSub.id },
              }),
              prisma.examSubmission.update({
                where: { id: partnerSub.id },
                data: { matchReport: reportJson, matchedWith: submission.id },
              }),
            ])

            // 通知搭档报告出来了
            sendToUser(partnerSub.userId, {
              type: 'collab:match-ready',
              submissionId: partnerSub.id,
              templateId: enrollment.template.id,
              courseName: enrollment.template.name,
            } as any)
            await createNotification({
              userId: partnerSub.userId,
              type: 'exam_grading' as any,  // 借用已有类型，通知搭档报告已就绪
              title: '🤝 匹配报告出来了！',
              content: `「${enrollment.template.name}」— 你们的匹配度：${matchReport.overallMatch}%`,
            }).catch(() => {})

          } else {
            // 搭档还没提交
            waitingForPartner = true
            console.log(`[CollabExam] 等待搭档提交 (templateId=${enrollment.template.id})`)
          }
        }
      } catch (e) {
        console.warn('[CollabExam] 匹配报告生成失败:', e)
      }
    }

    return NextResponse.json({
      submission: {
        id: submission.id,
        autoScore,
        totalScore,
        maxScore,
        passed,
        gradingStatus,
        answers: gradedAnswers,
        matchReport,
      },
      waitingForPartner,
      matchReady: !!matchReport,
    })
  } catch (error) {
    console.error('[Academy/Exam/Submit] 失败:', error)
    return NextResponse.json({ error: '提交考试失败' }, { status: 500 })
  }
}

'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { VideoPlayer } from '@/components/academy/VideoPlayer'
import { LessonList } from '@/components/academy/LessonList'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Enrollment {
  enrollmentId: string
  status: string
  progress: number
  completedSteps?: number[]
  paidTokens: number
  enrolledAt: string
  completedAt?: string | null
  course: {
    id: string
    name: string
    description?: string | null
    icon?: string | null
    courseType?: string | null
    price?: number | null
    coverImage?: string | null
    stepsCount: number
    enrollCount: number
    creator?: { name?: string | null; agent?: { id: string; name: string } | null } | null
    workspace?: { name?: string | null } | null
  }
  task?: {
    id: string
    status: string
    steps: Array<{
      id: string
      title: string
      status: string
      order: number
      assigneeType: string
    }>
  } | null
}

interface ExamQuestion {
  id: string
  type: string
  title: string
  points: number
  options?: string[]
  correctAnswer?: string | string[]
  uploadHint?: string
}

interface ExamSubmissionResult {
  id: string
  autoScore: number | null
  totalScore: number | null
  maxScore: number
  passed: boolean
  gradingStatus: string
  answers: any[]
  complaintText?: string | null
  complaintStatus?: string | null
}

interface CourseStep {
  index: number
  title: string
  description?: string
  assigneeType?: string
  videoUrl?: string | null
  htmlUrl?: string | null
  fileUrl?: string | null
  fileName?: string | null
  content?: string
  skillRef?: string | null
}

export default function LearnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: enrollmentId } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [courseSteps, setCourseSteps] = useState<CourseStep[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // 考试
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([])
  const [examPassScore, setExamPassScore] = useState(60)
  const [fullscreenFile, setFullscreenFile] = useState<{ url: string; name: string; isImage: boolean } | null>(null)
  const [showExam, setShowExam] = useState(false)
  const [examAnswers, setExamAnswers] = useState<Record<string, any>>({})
  const [examSubmission, setExamSubmission] = useState<ExamSubmissionResult | null>(null)
  const [examSubmitting, setExamSubmitting] = useState(false)
  const [examFileUploading, setExamFileUploading] = useState<string | null>(null)
  const [complaintText, setComplaintText] = useState('')
  const [complainting, setComplaining] = useState(false)
  // 人机共学
  const [isCollabExam, setIsCollabExam] = useState(false)
  const [isAgentUser, setIsAgentUser] = useState(false)
  const [matchReport, setMatchReport] = useState<any>(null)
  const [waitingForPartner, setWaitingForPartner] = useState(false)
  // HTML 课件全屏遮罩
  const [htmlFullscreen, setHtmlFullscreen] = useState(false)
  // 点赞
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [likeLoading, setLikeLoading] = useState(false)
  // 评论
  const [comments, setComments] = useState<any[]>([])
  const [mentionableUsers, setMentionableUsers] = useState<{ id: string; name: string | null; avatar: string | null }[]>([])
  const [commentText, setCommentText] = useState('')  // 显示文本（@Name 格式）
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({})  // name → userId
  const [commentSending, setCommentSending] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  // 呼叫 Agent
  const [showCallDialog, setShowCallDialog] = useState(false)
  const [callMsg, setCallMsg] = useState('')
  const [callSending, setCallSending] = useState(false)
  const [callSent, setCallSent] = useState(false)

  useEffect(() => {
    loadData()
  }, [enrollmentId])

  // 监听 HTML 课件发来的「完成」消息
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'teamagent:lesson-complete') {
        setHtmlFullscreen(false)
        handleMarkComplete(currentStep)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [currentStep, completedSteps])

  const loadData = async () => {
    setLoading(true)
    try {
      // 加载我的课程列表，找到对应 enrollment
      const res = await fetch('/api/academy/my-courses')
      if (!res.ok) {
        router.push('/login')
        return
      }

      const data = await res.json()
      const found = data.courses?.find((c: any) => c.enrollmentId === enrollmentId)

      if (!found) {
        router.push('/academy/my-courses')
        return
      }

      setEnrollment(found)

      // 加载点赞和评论
      loadLikeStatus(found.course.id)
      loadComments(found.course.id)

      // 加载课程详情（包含完整步骤）
      const courseRes = await fetch(`/api/academy/courses/${found.course.id}`)
      if (courseRes.ok) {
        const courseData = await courseRes.json()
        setCourseSteps(courseData.steps || [])

        // 检测当前用户是人类还是 Agent（用于跨类型学习判断 + 人机共学考试）
        const meRes = await fetch('/api/me').catch(() => null)
        const meData = meRes?.ok ? await meRes.json() : null
        const amAgent = !!meData?.agent
        setIsAgentUser(amAgent)

        // 加载考试信息
        if (courseData.examTemplate) {
          try {
            const exam = typeof courseData.examTemplate === 'string' ? JSON.parse(courseData.examTemplate) : courseData.examTemplate
            if (exam.type === 'collab') {
              // 人机共学：根据身份选择对应题目
              setIsCollabExam(true)
              // 根据身份选择对应题目
              const side = amAgent ? 'agent' : 'human'
              const collabQuestions = (exam.pairs || []).map((pair: any) => ({
                id: pair.id,
                type: pair[side]?.type || 'single_choice',
                title: pair[side]?.text || '',
                points: pair.points || 10,
                options: pair[side]?.options || [],
              }))
              setExamQuestions(collabQuestions)
            } else {
              // 兼容字段别名：score→points, question→title, single→single_choice
              setExamQuestions((exam.questions || []).map((q: any) => ({
                ...q,
                points: q.points ?? q.score ?? 0,
                title: q.title ?? q.question ?? '',
                type: q.type === 'single' ? 'single_choice' : q.type === 'multiple' ? 'multi_choice' : q.type,
              })))
            }
            setExamPassScore(courseData.examPassScore || exam.passScore || 60)
          } catch {}
        }
        // 加载已有考试提交
        try {
          const subRes = await fetch(`/api/academy/exam/submission?enrollmentId=${found.enrollmentId}`)
          if (subRes.ok) {
            const subData = await subRes.json()
            if (subData.submission) {
              setExamSubmission(subData.submission)
              if (subData.submission.matchReport) {
                setMatchReport(subData.submission.matchReport)
              }
            }
          }
        } catch {}

        // 计算已完成的步骤
        let completed: number[] = []

        if (found.task?.steps) {
          // Agent 课程：从 task steps 状态计算
          completed = found.task.steps
            .filter((s: any) => s.status === 'completed' || s.status === 'approved')
            .map((s: any) => s.order)
        } else if (found.completedSteps && found.completedSteps.length > 0) {
          // Human 课程：从持久化的 completedSteps 加载
          completed = found.completedSteps
        }

        if (completed.length > 0) {
          setCompletedSteps(completed)

          // 找到第一个未完成步骤作为当前步骤
          const firstIncomplete = (courseData.steps || []).findIndex(
            (_: any, i: number) => !completed.includes(i)
          )
          setCurrentStep(firstIncomplete >= 0 ? firstIncomplete : 0)
        }
      }
    } catch (e) {
      console.error('加载学习数据失败:', e)
    } finally {
      setLoading(false)
    }
  }

  // 加载点赞状态
  const loadLikeStatus = async (courseId: string) => {
    try {
      const res = await fetch(`/api/academy/courses/${courseId}/like`)
      if (res.ok) {
        const data = await res.json()
        setLiked(data.liked)
        setLikeCount(data.likeCount)
      }
    } catch {}
  }

  // 切换点赞
  const handleToggleLike = async () => {
    if (!enrollment || likeLoading) return
    setLikeLoading(true)
    try {
      const res = await fetch(`/api/academy/courses/${enrollment.course.id}/like`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setLiked(data.liked)
        setLikeCount(data.likeCount)
      }
    } catch {}
    setLikeLoading(false)
  }

  // 加载评论
  const loadComments = async (courseId: string) => {
    try {
      const res = await fetch(`/api/academy/courses/${courseId}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(data.comments || [])
        setMentionableUsers(data.mentionableUsers || [])
      }
    } catch {}
  }

  // 发表评论：将显示文本中的 @Name 转换为 @[Name](userId) 再发送
  const handleSendComment = async () => {
    if (!enrollment || !commentText.trim() || commentSending) return
    setCommentSending(true)
    try {
      // 把 @Name 替换成 @[Name](userId)
      let content = commentText.trim()
      for (const [name, userId] of Object.entries(mentionMap)) {
        content = content.replace(new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `@[${name}](${userId})`)
      }
      const res = await fetch(`/api/academy/courses/${enrollment.course.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (res.ok) {
        const data = await res.json()
        setComments(prev => [...prev, data.comment])
        setCommentText('')
        setMentionMap({})
      }
    } catch {}
    setCommentSending(false)
  }

  // 插入 @mention：输入框只显示 @Name，mentionMap 记录映射关系
  const insertMention = (user: { id: string; name: string | null }) => {
    const displayName = user.name || '用户'
    setCommentText(prev => {
      const lastAt = prev.lastIndexOf('@')
      if (lastAt >= 0) {
        return prev.substring(0, lastAt) + `@${displayName} `
      }
      return prev + `@${displayName} `
    })
    setMentionMap(prev => ({ ...prev, [displayName]: user.id }))
    setShowMentions(false)
    setMentionSearch('')
  }

  const handleVideoComplete = async (stepIndex: number) => {
    if (completedSteps.includes(stepIndex)) return

    // 标记步骤完成
    const newCompleted = [...completedSteps, stepIndex]
    setCompletedSteps(newCompleted)

    // 如果有 task，更新对应步骤状态（Agent 课程）
    if (enrollment?.task) {
      const step = enrollment.task.steps.find(s => s.order === stepIndex)
      if (step) {
        try {
          await fetch(`/api/steps/${step.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          })
        } catch (e) {
          // 忽略步骤更新错误
        }
      }
    }

    // 持久化进度到 CourseEnrollment（所有课程类型）
    if (enrollment) {
      try {
        await fetch('/api/academy/enrollments/progress', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enrollmentId: enrollment.enrollmentId,
            completedSteps: newCompleted,
          }),
        })
      } catch (e) {
        // 忽略持久化错误
      }
    }

    // 自动切换到下一步
    if (stepIndex < courseSteps.length - 1) {
      setTimeout(() => setCurrentStep(stepIndex + 1), 1500)
    }
  }

  const handleMarkComplete = async (stepIndex: number) => {
    handleVideoComplete(stepIndex)
  }

  // 提交考试
  const handleExamSubmit = async () => {
    if (!enrollment) return
    setExamSubmitting(true)
    try {
      const answers = examQuestions.map(q => ({
        questionId: q.id,
        answer: examAnswers[q.id] ?? '',
      }))
      const res = await fetch('/api/academy/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: enrollment.enrollmentId, answers }),
      })
      const data = await res.json()
      if (res.ok) {
        setExamSubmission(data.submission)
        if (data.matchReady && data.submission?.matchReport) {
          setMatchReport(data.submission.matchReport)
        }
        if (data.waitingForPartner) {
          setWaitingForPartner(true)
        }
      } else {
        alert(`提交失败：${data.error || '未知错误'}`)
      }
    } catch (e: any) {
      alert(`提交失败：${e.message || '网络错误'}`)
    }
    setExamSubmitting(false)
  }

  // 上传考试附件
  const handleExamFileUpload = async (questionId: string, file: File) => {
    setExamFileUploading(questionId)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setExamAnswers(prev => ({ ...prev, [questionId]: data.url }))
      }
    } catch {}
    setExamFileUploading(null)
  }

  // 投诉
  const handleComplaint = async () => {
    if (!examSubmission || !complaintText.trim()) return
    setComplaining(true)
    try {
      await fetch('/api/academy/exam/complaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: examSubmission.id, complaintText }),
      })
      setExamSubmission(prev => prev ? { ...prev, complaintStatus: 'pending', complaintText } : null)
      setComplaintText('')
    } catch {}
    setComplaining(false)
  }

  const hasExam = examQuestions.length > 0
  const allStepsCompleted = courseSteps.length > 0 && completedSteps.length >= courseSteps.length
  const examMaxScore = examQuestions.reduce((s, q) => s + q.points, 0)
  const isGraded = !!examSubmission && examSubmission.gradingStatus === 'graded'

  // 跨类型学习：可以学习但不能考试
  const courseType = enrollment?.course?.courseType || 'human'
  const isCrossType = (courseType === 'agent' && !isAgentUser) || (courseType === 'human' && isAgentUser)
  const canTakeExam = hasExam && !isCrossType

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🦞</div>
          <p className="mt-4 text-slate-400">加载课程中...</p>
        </div>
      </div>
    )
  }

  if (!enrollment || courseSteps.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl">😕</div>
          <p className="mt-4 text-slate-400">课程数据加载失败</p>
          <Link href="/academy/my-courses" className="mt-4 inline-block text-orange-400">
            ← 返回我的课程
          </Link>
        </div>
      </div>
    )
  }

  const step = courseSteps[currentStep]
  const progress = courseSteps.length > 0 ? Math.round((completedSteps.length / courseSteps.length) * 100) : 0
  const isStepCompleted = completedSteps.includes(currentStep)

  return (
    <>
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* 顶部栏 */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Link href="/academy/my-courses" className="text-slate-400 hover:text-orange-400 transition-colors">
            ←
          </Link>
          <h1 className="text-sm font-medium text-white truncate max-w-xs sm:max-w-md">
            {enrollment.course.name}
          </h1>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
            courseType === 'agent' ? 'border-blue-500/50 text-blue-400 bg-blue-500/10'
            : courseType === 'both' ? 'border-violet-500/50 text-violet-400 bg-violet-500/10'
            : 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
          }`}>
            {courseType === 'agent' ? '🤖 Agent课' : courseType === 'both' ? '🤝 人机共学' : '👤 人类课'}
          </span>
        </div>
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* 点赞 */}
          <button
            onClick={handleToggleLike}
            disabled={likeLoading}
            className={`flex items-center space-x-1 px-2 py-1 rounded-lg text-xs transition-all ${
              liked ? 'bg-orange-500/20 text-orange-400' : 'text-slate-500 hover:text-orange-400 hover:bg-slate-700'
            }`}
          >
            <span>{liked ? '👍' : '👍🏻'}</span>
            {likeCount > 0 && <span>{likeCount}</span>}
          </button>
          {/* 呼叫 Agent */}
          <button
            onClick={() => setShowCallDialog(true)}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-blue-400 hover:bg-slate-700 transition-all"
          >
            <span>📞</span>
            <span className="hidden sm:inline">呼叫讲师</span>
          </button>
          {/* 进度 */}
          <div className="flex items-center space-x-2">
            <div className="w-16 sm:w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-500 to-rose-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-slate-400">{progress}%</span>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden text-slate-400 hover:text-white p-1"
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：课程大纲（桌面端始终显示，移动端可切换） */}
        <div className={`${
          sidebarOpen ? 'block' : 'hidden'
        } md:block w-full md:w-72 lg:w-80 bg-slate-800/50 border-r border-slate-700 overflow-y-auto flex-shrink-0 absolute md:relative inset-0 md:inset-auto z-40 md:z-auto`}>
          <div className="p-4">
            {/* 课程信息卡片 */}
            <div className="mb-4 p-3 bg-slate-800/80 rounded-xl border border-slate-700 space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${
                  courseType === 'agent' ? 'border-blue-500/50 text-blue-400 bg-blue-500/10'
                  : courseType === 'both' ? 'border-violet-500/50 text-violet-400 bg-violet-500/10'
                  : 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                }`}>
                  {courseType === 'agent' ? '🤖 Agent课程' : courseType === 'both' ? '🤝 人机共学' : '👤 人类课程'}
                </span>
                {enrollment.course.creator?.agent && (
                  <span className="text-slate-500">by {enrollment.course.creator.agent.name}</span>
                )}
                {!enrollment.course.creator?.agent && enrollment.course.creator?.name && (
                  <span className="text-slate-500">by {enrollment.course.creator.name}</span>
                )}
              </div>
              {isCrossType && (
                <p className="text-[10px] text-amber-400/80 leading-relaxed">
                  ⚠️ {isAgentUser ? '你是 Agent，这是人类课程' : '你是人类，这是 Agent 课程'}——可以学习，但不可参加考试
                </p>
              )}
            </div>
            <LessonList
              steps={courseSteps}
              currentIndex={showExam ? -1 : currentStep}
              completedIndexes={completedSteps}
              onSelect={(index) => {
                setShowExam(false)
                setCurrentStep(index)
                setSidebarOpen(false) // 移动端选择后关闭侧栏
              }}
              isEnrolled={true}
            />
            {/* 考试入口（侧边栏） */}
            {hasExam && (
              isCrossType ? (
                <div className="mt-3 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs bg-slate-700/30 border border-slate-700 text-slate-500">
                  <span>📝</span>
                  <span>课程考试</span>
                  <span className="text-[10px] ml-auto">🚫 {courseType === 'agent' ? '人类不可考Agent课' : 'Agent不可考人类课'}</span>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (allStepsCompleted) {
                      setShowExam(true)
                      setSidebarOpen(false)
                    }
                  }}
                  disabled={!allStepsCompleted}
                  className={`mt-3 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    showExam ? 'bg-orange-500/20 border border-orange-500/40 text-orange-400' :
                    allStepsCompleted ? 'bg-slate-700/50 text-orange-400 hover:bg-orange-500/10 border border-slate-600' :
                    'bg-slate-700/30 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
                >
                  <span>📝</span>
                  <span>课程考试</span>
                  {!allStepsCompleted && <span className="text-[10px] text-slate-600 ml-auto">🔒 完成课时解锁</span>}
                  {examSubmission?.passed && <span className="text-[10px] text-emerald-400 ml-auto">✅ 已通过</span>}
                </button>
              )
            )}
          </div>
        </div>

        {/* 右侧：当前课时内容 */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {showExam ? (
            /* ── 考试界面 ── */
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">📝 课程考试</h2>
                <button onClick={() => setShowExam(false)} className="text-sm text-slate-400 hover:text-white">← 返回课程</button>
              </div>
              <p className="text-xs text-slate-500 mb-6">共 {examQuestions.length} 题，满分 {examMaxScore} 分，及格 {examPassScore} 分。无限次重考。</p>

              {/* 已提交结果 */}
              {examSubmission && examSubmission.gradingStatus !== 'pending' && (
                <div className={`mb-6 rounded-xl p-4 border ${
                  examSubmission.passed ? 'bg-emerald-500/10 border-emerald-500/30' :
                  examSubmission.gradingStatus === 'manual_grading' ? 'bg-amber-500/10 border-amber-500/30' :
                  'bg-red-500/10 border-red-500/30'
                }`}>
                  {examSubmission.gradingStatus === 'manual_grading' ? (
                    <p className="text-sm text-amber-400">⏳ 客观题已自动批改（得分 {examSubmission.autoScore}），主观题等待创建者阅卷...</p>
                  ) : examSubmission.passed ? (
                    <div>
                      <p className="text-sm text-emerald-400 font-medium">✅ 考试通过！成绩: {examSubmission.totalScore}/{examSubmission.maxScore}</p>
                      <a href={`/academy/certificate/${enrollmentId}`} className="mt-2 inline-block text-xs text-orange-400 hover:underline">🏆 查看证书 →</a>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-red-400">❌ 未通过。成绩: {examSubmission.totalScore}/{examSubmission.maxScore}（需 {examPassScore} 分）</p>
                      <p className="text-xs text-slate-500 mt-1">可以修改答案后重新提交</p>
                    </div>
                  )}

                  {/* 投诉区域 */}
                  {examSubmission.gradingStatus === 'graded' && !examSubmission.passed && (
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      {examSubmission.complaintStatus === 'pending' ? (
                        <p className="text-xs text-amber-400">📮 投诉已提交，等待 Professor Lobster 仲裁</p>
                      ) : examSubmission.complaintStatus === 'resolved' || examSubmission.complaintStatus === 'dismissed' ? (
                        <p className="text-xs text-slate-400">仲裁结果: {examSubmission.complaintStatus === 'resolved' ? '✅ 已调分' : '❌ 维持原判'}</p>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={complaintText}
                            onChange={e => setComplaintText(e.target.value)}
                            placeholder="不服评分？说明理由，Professor Lobster 将仲裁"
                            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                          />
                          <button
                            onClick={handleComplaint}
                            disabled={complainting || !complaintText.trim()}
                            className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 px-3 py-1.5 rounded-lg disabled:opacity-50"
                          >
                            {complainting ? '...' : '投诉'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── 通过后：证书 + 解锁成就 ── */}
              {examSubmission?.passed && (
                <div className="mb-6 space-y-3">
                  <a
                    href={`/academy/certificate/${enrollmentId}`}
                    className="flex items-center gap-4 bg-gradient-to-r from-orange-500/15 to-rose-500/15 border border-orange-500/40 rounded-xl p-4 hover:border-orange-500/60 transition-colors group"
                  >
                    <div className="text-4xl">🏆</div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-orange-300">结业证书已颁发！</p>
                      <p className="text-xs text-slate-400 mt-0.5">点击查看并下载你的结业证书</p>
                    </div>
                    <span className="text-orange-400 group-hover:translate-x-1 transition-transform text-lg">→</span>
                  </a>
                  {courseSteps.some(s => s.skillRef) && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                      <p className="text-sm font-semibold text-emerald-300 mb-3">🎁 已解锁 Principle 技能文件</p>
                      <div className="flex flex-wrap gap-2">
                        {[...new Set(courseSteps.filter(s => s.skillRef).map(s => s.skillRef as string))].map(ref => (
                          <span key={ref} className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs px-3 py-1.5 rounded-full">
                            📄 {ref.split('/').pop() || ref}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-2">以上 Principle 文件已保存在你的 Agent skill 文件夹中</p>
                    </div>
                  )}
                </div>
              )}

              {/* 人机共学标识 */}
              {isCollabExam && (
                <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                  <span className="text-lg">{isAgentUser ? '🤖' : '👤'}</span>
                  <span className="text-sm text-violet-300 font-medium">人机共学课程 — 你的身份：{isAgentUser ? 'Agent 视角' : '人类视角'}</span>
                  <span className="text-xs text-slate-500 ml-auto">双方提交后解锁匹配报告</span>
                </div>
              )}

              {/* 等待搭档 */}
              {waitingForPartner && !matchReport && (
                <div className="mb-6 rounded-xl p-5 bg-violet-500/10 border border-violet-500/30 text-center">
                  <div className="text-2xl mb-2">⏳</div>
                  <p className="text-violet-300 font-medium">你的答案已提交！</p>
                  <p className="text-sm text-slate-400 mt-1">等待搭档完成作答，匹配报告将自动生成</p>
                </div>
              )}

              {/* 匹配报告 */}
              {matchReport && (
                <div className="mb-6 rounded-2xl bg-gradient-to-br from-violet-900/40 to-slate-800 border border-violet-500/30 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">🤝</span>
                    <div>
                      <h3 className="text-lg font-bold text-white">人机匹配报告</h3>
                      <p className="text-xs text-slate-400">不评对错，只看想法像不像</p>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-4xl font-black text-violet-400">{matchReport.overallMatch}%</div>
                      <div className="text-xs text-slate-500">匹配度</div>
                    </div>
                  </div>

                  {/* 最像 / 最不同 */}
                  {matchReport.mostSimilar && (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                        <p className="text-xs text-emerald-400 font-medium mb-1">最像的地方 ✨</p>
                        <p className="text-sm text-white">{matchReport.mostSimilar.label}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          人类: {matchReport.mostSimilar.humanAnswer} · Agent: {matchReport.mostSimilar.agentAnswer}
                        </p>
                      </div>
                      {matchReport.mostDifferent && (
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3">
                          <p className="text-xs text-orange-400 font-medium mb-1">最不同的地方 🔍</p>
                          <p className="text-sm text-white">{matchReport.mostDifferent.label}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            人类: {matchReport.mostDifferent.humanAnswer} · Agent: {matchReport.mostDifferent.agentAnswer}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 画像 */}
                  {(matchReport.humanPortrait || matchReport.agentPortrait) && (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {matchReport.humanPortrait && (
                        <div className="bg-slate-700/50 rounded-xl p-3">
                          <p className="text-xs text-slate-500 mb-1">👤 人类眼中的 Agent</p>
                          <p className="text-sm text-slate-200 italic">「{matchReport.humanPortrait}」</p>
                        </div>
                      )}
                      {matchReport.agentPortrait && (
                        <div className="bg-slate-700/50 rounded-xl p-3">
                          <p className="text-xs text-slate-500 mb-1">🤖 Agent 眼中的人类</p>
                          <p className="text-sm text-slate-200 italic">「{matchReport.agentPortrait}」</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 推荐 */}
                  <p className="text-sm text-violet-300 text-center">{matchReport.recommendation}</p>
                </div>
              )}

              {/* 题目列表 */}
              <div className="space-y-6">
                {examQuestions.map((q, qi) => {
                  const prevAnswer = examSubmission?.answers?.find((a: any) => a.questionId === q.id)
                  return (
                    <div key={q.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold">{qi + 1}</span>
                        <span className="text-xs text-slate-500">
                          {q.type === 'single_choice' ? '单选' : q.type === 'multi_choice' ? '多选' : q.type === 'short_answer' ? '简答' : q.type === 'essay' ? '论述' : '实操上传'}
                        </span>
                        <span className="text-xs text-slate-500">({q.points} 分)</span>
                        {prevAnswer?.autoScore !== undefined && prevAnswer?.autoScore !== null && (
                          <span className={`text-xs ${prevAnswer.autoScore > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            得分: {prevAnswer.autoScore}
                          </span>
                        )}
                        {prevAnswer?.manualScore !== undefined && prevAnswer?.manualScore !== null && (
                          <span className="text-xs text-blue-400">人工: {prevAnswer.manualScore}</span>
                        )}
                      </div>
                      <p className="text-sm text-white mb-3 whitespace-pre-wrap">{q.title}</p>

                      {/* 单选 */}
                      {q.type === 'single_choice' && q.options && (
                        <div className="space-y-2">
                          {q.options.map((opt, oi) => {
                            const label = String.fromCharCode(65 + oi)
                            const myAns = examAnswers[q.id] === label || (isGraded && !examAnswers[q.id] && (examSubmission?.answers?.find((a: any) => a.questionId === q.id)?.answer === label))
                            const selected = examAnswers[q.id] === label
                            const correct = isGraded && q.correctAnswer === label
                            const wrong = isGraded && myAns && !correct
                            return (
                              <button
                                key={oi}
                                onClick={() => !isGraded && setExamAnswers(prev => ({ ...prev, [q.id]: label }))}
                                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                                  correct ? 'bg-emerald-500/20 border border-emerald-500/40 text-white' :
                                  wrong ? 'bg-red-500/15 border border-red-500/30 text-slate-400' :
                                  selected ? 'bg-orange-500/20 border border-orange-500/40 text-white' :
                                  'bg-slate-700 border border-slate-600 text-slate-300 hover:border-slate-500'
                                }`}
                              >
                                <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                  correct ? 'border-emerald-500 bg-emerald-500/30 text-emerald-300' :
                                  wrong ? 'border-red-500 bg-red-500/20 text-red-400' :
                                  selected ? 'border-orange-500 bg-orange-500/30 text-orange-300' :
                                  'border-slate-500 text-slate-500'
                                }`}>{correct ? '✓' : label}</span>
                                {opt}
                                {correct && <span className="ml-auto text-[10px] text-emerald-400">正确答案</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* 多选 */}
                      {q.type === 'multi_choice' && q.options && (
                        <div className="space-y-2">
                          {q.options.map((opt, oi) => {
                            const label = String.fromCharCode(65 + oi)
                            const selected = Array.isArray(examAnswers[q.id]) && examAnswers[q.id].includes(label)
                            const correct = isGraded && Array.isArray(q.correctAnswer) && q.correctAnswer.includes(label)
                            const wrong = isGraded && selected && !correct
                            return (
                              <button
                                key={oi}
                                onClick={() => {
                                  if (isGraded) return
                                  setExamAnswers(prev => {
                                    const curr = Array.isArray(prev[q.id]) ? [...prev[q.id]] : []
                                    return { ...prev, [q.id]: selected ? curr.filter((x: string) => x !== label) : [...curr, label] }
                                  })
                                }}
                                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                                  correct ? 'bg-emerald-500/20 border border-emerald-500/40 text-white' :
                                  wrong ? 'bg-red-500/15 border border-red-500/30 text-slate-400' :
                                  selected ? 'bg-orange-500/20 border border-orange-500/40 text-white' :
                                  'bg-slate-700 border border-slate-600 text-slate-300 hover:border-slate-500'
                                }`}
                              >
                                <span className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                  correct ? 'border-emerald-500 bg-emerald-500/30 text-emerald-300' :
                                  wrong ? 'border-red-500 bg-red-500/20 text-red-400' :
                                  selected ? 'border-orange-500 bg-orange-500/30 text-orange-300' :
                                  'border-slate-500 text-slate-500'
                                }`}>{correct ? '✓' : selected ? '✓' : label}</span>
                                {opt}
                                {correct && <span className="ml-auto text-[10px] text-emerald-400">✓ 正确</span>}
                              </button>
                            )
                          })}
                          {!isGraded && <p className="text-[10px] text-slate-500 ml-7">可多选</p>}
                        </div>
                      )}

                      {/* 简答/论述 */}
                      {(q.type === 'short_answer' || q.type === 'essay') && (
                        <textarea
                          value={examAnswers[q.id] || ''}
                          onChange={e => setExamAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder={q.type === 'short_answer' ? '请简要回答...' : '请详细论述...'}
                          rows={q.type === 'essay' ? 6 : 3}
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none"
                        />
                      )}

                      {/* 实操上传 */}
                      {q.type === 'practical_upload' && (
                        <div>
                          {q.uploadHint && <p className="text-xs text-slate-500 mb-2">{q.uploadHint}</p>}
                          {examAnswers[q.id] ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-emerald-400">📎 已上传</span>
                              <a href={examAnswers[q.id]} target="_blank" rel="noopener" className="text-xs text-orange-400 hover:underline truncate max-w-xs">{examAnswers[q.id].split('/').pop()}</a>
                              <button onClick={() => setExamAnswers(prev => ({ ...prev, [q.id]: '' }))} className="text-xs text-slate-500 hover:text-red-400">✕</button>
                            </div>
                          ) : (
                            <label className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-orange-400 cursor-pointer">
                              <span>{examFileUploading === q.id ? '上传中...' : '📎 上传文件'}</span>
                              <input
                                type="file"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleExamFileUpload(q.id, f); e.target.value = '' }}
                                disabled={examFileUploading === q.id}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      )}

                      {/* 阅卷反馈 */}
                      {prevAnswer?.feedback && (
                        <div className="mt-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-blue-400">
                          💬 阅卷反馈: {prevAnswer.feedback}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 提交按钮 */}
              {(!examSubmission || !examSubmission.passed) && (
                <div className="mt-6 text-center">
                  <button
                    onClick={handleExamSubmit}
                    disabled={examSubmitting}
                    className="bg-gradient-to-r from-orange-500 to-rose-500 text-white px-8 py-3 rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition-all disabled:opacity-50"
                  >
                    {examSubmitting ? '提交中...' : '📝 提交考试'}
                  </button>
                </div>
              )}
            </div>
          ) : step ? (
            <div className="max-w-3xl mx-auto">
              {/* 课时标题 */}
              <div className="mb-4">
                <div className="flex items-center space-x-2 text-xs text-slate-500 mb-1">
                  <span>第 {currentStep + 1} 课</span>
                  <span>·</span>
                  <span>
                    {step.assigneeType === 'human' ? '🧑 人类课'
                      : step.assigneeType === 'agent' ? '🤖 Agent 课'
                      : '🤝 共学课'}
                  </span>
                  {isStepCompleted && (
                    <>
                      <span>·</span>
                      <span className="text-emerald-400">✓ 已完成</span>
                    </>
                  )}
                </div>
                <h2 className="text-xl font-bold text-white">{step.title}</h2>
                {step.description && (
                  <div className="mt-2 text-slate-400 prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.description}</ReactMarkdown>
                  </div>
                )}
              </div>

              {/* 视频内容 */}
              {step.videoUrl && (
                <div className="mb-6">
                  <VideoPlayer
                    src={step.videoUrl}
                    title={step.title}
                    onComplete={() => handleVideoComplete(currentStep)}
                  />
                </div>
              )}

              {/* HTML 互动课件 */}
              {step.htmlUrl && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🌐</span>
                      <span className="text-sm font-medium text-blue-400">互动课件</span>
                    </div>
                    <button
                      onClick={() => setHtmlFullscreen(true)}
                      className="flex items-center space-x-1 text-xs text-slate-400 hover:text-blue-400 transition-colors"
                    >
                      <span>⛶</span>
                      <span>全屏查看</span>
                    </button>
                  </div>
                  <div className="w-full rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
                    <iframe
                      src={step.htmlUrl}
                      title={step.title}
                      className="w-full"
                      style={{ minHeight: '420px' }}
                      sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                  </div>
                </div>
              )}

              {/* HTML 课件全屏遮罩 */}
              {htmlFullscreen && step?.htmlUrl && (
                <div className="fixed inset-0 z-50 bg-black flex flex-col">
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700 flex-shrink-0">
                    <span className="text-sm text-slate-300 truncate">{step.title}</span>
                    <button
                      onClick={() => setHtmlFullscreen(false)}
                      className="ml-4 flex items-center gap-1.5 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                    >
                      ✕ 退出全屏
                    </button>
                  </div>
                  <iframe
                    src={step.htmlUrl}
                    title={step.title}
                    className="flex-1 w-full"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                  />
                </div>
              )}

              {/* 附件（PDF/Word/PPT）— 全屏展示 */}
              {step.fileUrl && (() => {
                const url = step.fileUrl.toLowerCase()
                const isPdf = url.endsWith('.pdf')
                const isOffice = url.endsWith('.ppt') || url.endsWith('.pptx') || url.endsWith('.doc') || url.endsWith('.docx') || url.endsWith('.xls') || url.endsWith('.xlsx')
                const isImage = url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif') || url.endsWith('.webp')
                const fullUrl = step.fileUrl.startsWith('http') ? step.fileUrl : `${window.location.origin}${step.fileUrl}`
                const officeViewerUrl = isOffice ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fullUrl)}` : null
                const displayUrl = officeViewerUrl || (isPdf ? step.fileUrl : null)

                return (
                  <div className="mb-6 bg-slate-800 rounded-xl border border-slate-700 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-lg">📎</span>
                        <span className="text-sm font-medium text-violet-400">课程附件</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* 全屏展示按钮 */}
                        {(displayUrl || isImage) && (
                          <button
                            onClick={() => setFullscreenFile({ url: (isImage ? step.fileUrl : displayUrl) || '', name: step.fileName || '', isImage })}
                            className="flex items-center gap-1.5 text-xs text-white bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 px-3 py-1.5 rounded-lg transition-colors shadow"
                          >
                            🖥️ 全屏展示
                          </button>
                        )}
                        <a
                          href={step.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-orange-400 bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          ⬇️ 下载
                        </a>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-300">{step.fileName || step.fileUrl.split('/').pop()}</div>
                    {/* 内嵌展示：PDF 原生 / PPT+Word 用 Office Online Viewer / 图片直接显示 */}
                    {isImage && (
                      <div className="mt-3 w-full rounded-lg border border-slate-700 overflow-hidden cursor-pointer" onClick={() => setFullscreenFile({ url: step.fileUrl || '', name: step.fileName || '', isImage: true })}>
                        <img src={step.fileUrl} alt={step.fileName || '图片'} className="w-full object-contain max-h-[500px]" />
                      </div>
                    )}
                    {displayUrl && (
                      <div className="mt-3 w-full rounded-lg border border-slate-700 overflow-hidden">
                        <iframe
                          src={displayUrl}
                          title={step.fileName || '附件展示'}
                          className="w-full"
                          style={{ minHeight: '600px' }}
                          allowFullScreen
                        />
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Agent 课内容 */}
              {step.assigneeType === 'agent' && step.content && (
                <div className="mb-6 bg-slate-800 rounded-xl border border-slate-700 p-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <span className="text-lg">🤖</span>
                    <span className="text-sm font-medium text-purple-400">Agent 任务</span>
                  </div>
                  <div className="text-sm text-slate-300 prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.content}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* 手动完成按钮（视频课看完自动完成，其他类型均可手动打卡） */}
              {!step.videoUrl && !isStepCompleted && (
                <button
                  onClick={() => handleMarkComplete(currentStep)}
                  className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-6 py-2.5 rounded-xl font-medium hover:from-emerald-600 hover:to-teal-600 transition-all"
                >
                  ✓ 已读完，标记完成
                </button>
              )}

              {/* 导航按钮 */}
              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  disabled={currentStep === 0}
                  className="text-sm text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  ← 上一课
                </button>

                {currentStep < courseSteps.length - 1 ? (
                  <button
                    onClick={() => setCurrentStep(currentStep + 1)}
                    className="text-sm bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 px-4 py-2 rounded-lg transition-colors"
                  >
                    下一课 →
                  </button>
                ) : (
                  progress >= 100 && !hasExam && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-emerald-400 font-medium">
                        🎓 恭喜完成全部课程！
                      </span>
                      <a
                        href={`/academy/certificate/${enrollmentId}`}
                        className="text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white px-4 py-1.5 rounded-lg hover:from-orange-600 hover:to-rose-600 transition-colors"
                      >
                        🏆 查看证书
                      </a>
                    </div>
                  )
                )}

                {/* 跨类型学习提示 */}
                {isCrossType && allStepsCompleted && !showExam && (
                  <div className="mt-6 bg-slate-700/30 border border-slate-600 rounded-xl p-4 text-center">
                    <p className="text-sm text-slate-400 mb-1">🎓 全部课时已完成！</p>
                    <p className="text-xs text-slate-500">
                      {courseType === 'agent' ? '这是 Agent 课程，人类学员可以学习但不可参加考试' : '这是人类课程，Agent 学员可以学习但不可参加考试'}
                    </p>
                  </div>
                )}
                {/* 考试入口 */}
                {canTakeExam && allStepsCompleted && !showExam && (
                  <div className="mt-6 bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 text-center">
                    <p className="text-sm text-orange-400 mb-2">📝 全部课时已完成，请参加考试</p>
                    {examSubmission && examSubmission.gradingStatus === 'graded' && (
                      <p className="text-xs text-slate-400 mb-2">
                        上次成绩: {examSubmission.totalScore}/{examSubmission.maxScore} —
                        {examSubmission.passed
                          ? <span className="text-emerald-400"> 已通过</span>
                          : <span className="text-red-400"> 未通过，可重新考试</span>
                        }
                      </p>
                    )}
                    {examSubmission?.passed ? (
                      <a
                        href={`/academy/certificate/${enrollmentId}`}
                        className="inline-block text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white px-6 py-2 rounded-xl hover:from-orange-600 hover:to-rose-600 transition-colors"
                      >
                        🏆 查看证书
                      </a>
                    ) : (
                      <button
                        onClick={() => setShowExam(true)}
                        className="text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white px-6 py-2 rounded-xl hover:from-orange-600 hover:to-rose-600 transition-colors"
                      >
                        {examSubmission ? '🔄 重新考试' : '📝 开始考试'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-400">
              请从左侧选择课时
            </div>
          )}

          {/* ── 评论区 ── */}
          {!showExam && (
            <div className="max-w-3xl mx-auto mt-10 border-t border-slate-700 pt-6">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                💬 课程讨论 <span className="text-xs font-normal text-slate-500">({comments.length})</span>
              </h3>

              {/* 评论列表 */}
              <div className="space-y-3 mb-4 max-h-96 overflow-y-auto">
                {comments.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-4">暂无评论，来说点什么吧 🦞</p>
                )}
                {comments.map((c: any) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0">
                      {c.author?.avatar ? (
                        <img src={c.author.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-300">
                          {c.author?.name || '学员'}
                        </span>
                        {c.author?.agent && (
                          <span className="text-[10px] text-orange-400/70">· {c.author.agent.name}</span>
                        )}
                        <span className="text-[10px] text-slate-600">
                          {new Date(c.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 whitespace-pre-wrap break-words">
                        {c.content.replace(/@\[([^\]]+)\]\([a-zA-Z0-9_-]+\)/g, '@$1')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 评论输入框 */}
              <div className="relative">
                {showMentions && (
                  <div className="absolute bottom-full mb-1 left-0 right-0 bg-slate-800 border border-slate-600 rounded-lg max-h-40 overflow-y-auto z-50 shadow-xl">
                    {mentionableUsers
                      .filter(u => !mentionSearch || u.name?.toLowerCase().includes(mentionSearch.toLowerCase()))
                      .map(u => (
                        <button
                          key={u.id}
                          onClick={() => insertMention(u)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          <span className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center text-[10px]">
                            {u.avatar ? <img src={u.avatar} alt="" className="w-5 h-5 rounded-full" /> : '👤'}
                          </span>
                          {u.name || '用户'}
                        </button>
                      ))}
                    {mentionableUsers.filter(u => !mentionSearch || u.name?.toLowerCase().includes(mentionSearch.toLowerCase())).length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-500">没有匹配的用户</p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={commentText}
                      onChange={e => {
                        setCommentText(e.target.value)
                        // 检测 @ 触发
                        const val = e.target.value
                        const lastAt = val.lastIndexOf('@')
                        if (lastAt >= 0 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
                          const afterAt = val.slice(lastAt + 1)
                          if (!afterAt.includes(' ') && !afterAt.includes('[')) {
                            setShowMentions(true)
                            setMentionSearch(afterAt)
                            return
                          }
                        }
                        setShowMentions(false)
                      }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment() } }}
                      placeholder="发表评论... 输入 @ 可提及同学"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <button
                    onClick={() => setShowMentions(!showMentions)}
                    className="text-slate-500 hover:text-orange-400 px-2 transition-colors"
                    title="@提及"
                  >
                    @
                  </button>
                  <button
                    onClick={handleSendComment}
                    disabled={commentSending || !commentText.trim()}
                    className="bg-orange-500 hover:bg-orange-600 text-white text-xs px-4 py-2 rounded-lg disabled:opacity-40 transition-colors"
                  >
                    {commentSending ? '...' : '发送'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 呼叫 Agent 对话框 */}
      {showCallDialog && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => { setShowCallDialog(false); setCallSent(false); setCallMsg('') }}>
          <div className="bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-xl">📞</span>
                <div>
                  <h3 className="text-sm font-bold text-white">呼叫讲师</h3>
                  <p className="text-xs text-slate-400">{enrollment?.course.creator?.agent?.name || enrollment?.course.creator?.name || '讲师 Agent'}</p>
                </div>
              </div>
              <button onClick={() => { setShowCallDialog(false); setCallSent(false); setCallMsg('') }} className="text-slate-500 hover:text-white text-lg">✕</button>
            </div>
            {callSent ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-white font-medium mb-1">消息已发送！</p>
                <p className="text-xs text-slate-400">讲师 Agent 会尽快回复你</p>
                <button onClick={() => { setShowCallDialog(false); setCallSent(false); setCallMsg('') }} className="mt-4 bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-xl text-sm transition-colors">关闭</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-3">课程：{enrollment?.course.name}</p>
                <textarea
                  value={callMsg}
                  onChange={e => setCallMsg(e.target.value)}
                  placeholder="有什么问题想问讲师？"
                  rows={3}
                  className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-orange-500/50 resize-none mb-3"
                />
                <button
                  disabled={!callMsg.trim() || callSending}
                  onClick={async () => {
                    if (!callMsg.trim()) return
                    setCallSending(true)
                    try {
                      const res = await fetch('/api/academy/message-instructor', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          courseId: enrollment?.course.id,
                          message: callMsg,
                        }),
                      })
                      const data = await res.json()
                      if (data.channelId && data.workspaceId) {
                        // 跳转到 DM 频道，开始实时对话
                        window.location.href = `/channels?ws=${data.workspaceId}&c=${data.channelId}`
                        return
                      }
                      setCallSent(true)
                    } catch {
                      // ignore
                    } finally {
                      setCallSending(false)
                    }
                  }}
                  className="w-full py-2 rounded-xl text-sm font-medium transition-all bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {callSending ? '发送中...' : '发送给讲师 Agent'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>

      {/* 全屏展示 Modal */}
      {fullscreenFile && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* 顶栏 */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 backdrop-blur">
            <span className="text-sm text-white truncate">{fullscreenFile.name || '全屏展示'}</span>
            <button
              onClick={() => setFullscreenFile(null)}
              className="text-white bg-slate-700 hover:bg-red-500 px-4 py-1.5 rounded-lg text-sm transition-colors"
            >
              ✕ 关闭
            </button>
          </div>
          {/* 内容 */}
          <div className="flex-1 overflow-hidden">
            {fullscreenFile.isImage ? (
              <div className="w-full h-full flex items-center justify-center p-4">
                <img src={fullscreenFile.url} alt={fullscreenFile.name} className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <iframe
                src={fullscreenFile.url}
                title={fullscreenFile.name}
                className="w-full h-full border-0"
                allowFullScreen
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

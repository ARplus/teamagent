'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Answer {
  questionId: string
  question: string
  type: string // single, multi, single_choice, multi_choice, short_answer, essay, practical_upload
  options?: { id: string; text: string }[]
  correct?: string | string[]
  selected?: string | string[]
  answer?: string
  score: number
  autoScore?: number
  manualScore?: number
  feedback?: string
}

interface Submission {
  id: string
  totalScore: number
  autoScore: number
  manualScore: number
  maxScore: number
  passed: boolean
  gradingStatus: string
  gradingNote?: string | null
  submittedAt: string
  gradedAt?: string | null
  answers: Answer[]
  user: { name: string }
  template?: { name: string }
}

export default function ExamResultPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const enrollmentId = params.enrollmentId as string

  const [submission, setSubmission] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [courseName, setCourseName] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session) return
    fetch(`/api/academy/exam/submission?enrollmentId=${enrollmentId}`)
      .then(r => r.json())
      .then(data => {
        setSubmission(data.submission)
        setCourseName(data.submission?.template?.name || '')
      })
      .finally(() => setLoading(false))
  }, [session, enrollmentId])

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-slate-400">加载中...</div>
    </div>
  )

  if (!submission) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-slate-400">暂无考试记录</div>
    </div>
  )

  const getOptionResult = (ans: Answer, optId: string) => {
    const isCorrect = Array.isArray(ans.correct)
      ? ans.correct.includes(optId)
      : ans.correct === optId
    const isSelected = Array.isArray(ans.selected)
      ? ans.selected.includes(optId)
      : ans.selected === optId
    if (isSelected && isCorrect) return 'correct'
    if (isSelected && !isCorrect) return 'wrong'
    if (!isSelected && isCorrect) return 'missed'
    return 'neutral'
  }

  const scoreColor = submission.passed ? 'text-emerald-400' : 'text-red-400'
  const scoreBg = submission.passed ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* 返回 */}
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-orange-400 transition-colors mb-6">
          <span>←</span><span>返回</span>
        </button>

        {/* 标题 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <span>📝</span><span>考试记录</span>
          </div>
          <h1 className="text-xl font-bold text-white">{courseName || '课程考试'}</h1>
          <p className="text-xs text-slate-500 mt-1">
            提交时间：{submission.submittedAt ? new Date(submission.submittedAt).toLocaleString('zh-CN') : '未知'}
          </p>
        </div>

        {/* 总分卡片 */}
        <div className={`rounded-2xl border p-5 mb-6 ${scoreBg}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400 mb-1">最终得分</div>
              <div className={`text-4xl font-bold ${scoreColor}`}>
                {submission.totalScore}
                <span className="text-lg text-slate-500 font-normal"> / {submission.maxScore}</span>
              </div>
              {submission.autoScore > 0 && submission.manualScore > 0 && (
                <div className="text-xs text-slate-500 mt-1">
                  客观题 {submission.autoScore} + 主观题 {submission.manualScore}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${scoreColor}`}>
                {submission.passed ? '✅ 通过' : '❌ 未通过'}
              </div>
              {submission.gradingStatus === 'graded' && (
                <div className="text-xs text-slate-500 mt-1">已批改</div>
              )}
              {submission.gradingStatus === 'pending' && (
                <div className="text-xs text-amber-400 mt-1">⏳ 等待批改</div>
              )}
            </div>
          </div>

          {/* 阅卷备注 */}
          {submission.gradingNote && (
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="text-xs text-slate-500 mb-1">讲师阅卷备注</div>
              <div className="text-sm text-slate-300 italic">"{submission.gradingNote}"</div>
            </div>
          )}
        </div>

        {/* 题目详情 */}
        <div className="space-y-4">
          {submission.answers.map((ans, idx) => {
            // 统一类型判断：single/single_choice → 客观, multi/multi_choice/multiple → 客观, 其余 → 主观
            const normalizedType = ans.type === 'single' || ans.type === 'single_choice' ? 'single_choice'
              : ans.type === 'multi' || ans.type === 'multi_choice' || ans.type === 'multiple' ? 'multi_choice'
              : ans.type === 'short_answer' ? 'short_answer'
              : ans.type === 'practical_upload' ? 'practical_upload'
              : 'essay'
            const isObjective = normalizedType === 'single_choice' || normalizedType === 'multi_choice'
            const isSubjective = !isObjective

            const typeLabel = normalizedType === 'single_choice' ? '单选'
              : normalizedType === 'multi_choice' ? '多选'
              : normalizedType === 'short_answer' ? '简答'
              : normalizedType === 'practical_upload' ? '实操上传'
              : '论述'

            const earnedScore = isSubjective ? (ans.manualScore ?? ans.autoScore ?? 0) : (ans.autoScore ?? 0)
            const isFullScore = earnedScore >= ans.score
            const isZero = earnedScore === 0

            return (
              <div key={ans.questionId} className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                {/* 题目头 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-700 text-xs flex items-center justify-center text-slate-300 font-medium flex-shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-xs text-slate-500">
                      {typeLabel}（{ans.score} 分）
                    </span>
                  </div>
                  <span className={`text-sm font-semibold ${isFullScore ? 'text-emerald-400' : isZero ? 'text-red-400' : 'text-amber-400'}`}>
                    {earnedScore}/{ans.score}
                  </span>
                </div>

                {/* 题目内容 */}
                <div className="text-sm text-white mb-3 leading-relaxed">{ans.question}</div>

                {/* 客观题选项 */}
                {isObjective && ans.options && (
                  <div className="space-y-2 mb-3">
                    {ans.options.map(opt => {
                      const result = getOptionResult(ans, opt.id)
                      const styles: Record<string, string> = {
                        correct: 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300',
                        wrong: 'bg-red-500/15 border-red-500/50 text-red-300',
                        missed: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                        neutral: 'bg-slate-700/50 border-slate-700 text-slate-400',
                      }
                      const icons: Record<string, string> = { correct: '✓', wrong: '✗', missed: '→', neutral: '' }
                      return (
                        <div key={opt.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${styles[result]}`}>
                          <span className="font-mono w-4 flex-shrink-0">{opt.id}.</span>
                          <span className="flex-1">{opt.text}</span>
                          {icons[result] && <span className="flex-shrink-0 font-bold">{icons[result]}</span>}
                        </div>
                      )
                    })}
                    <div className="text-xs text-slate-500 mt-1">
                      正确答案：{Array.isArray(ans.correct) ? ans.correct.join('、') : ans.correct}
                    </div>
                  </div>
                )}

                {/* 主观题答案 */}
                {isSubjective && (
                  <div className="mb-3">
                    <div className="text-xs text-slate-500 mb-1">我的答案</div>
                    <div className="bg-slate-700/50 rounded-lg p-3 text-sm text-slate-300 leading-relaxed">
                      {ans.answer || <span className="text-slate-500 italic">未作答</span>}
                    </div>
                  </div>
                )}

                {/* 讲师反馈 */}
                {ans.feedback && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <div className="text-xs text-orange-400/80 mb-1">讲师批注</div>
                    <div className="text-sm text-slate-300 prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{ans.feedback}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-8 text-center">
          <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            ← 返回我的课程
          </button>
        </div>
      </div>
    </div>
  )
}

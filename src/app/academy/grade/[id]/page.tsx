'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface GradingSubmission {
  id: string
  enrollmentId: string
  autoScore: number | null
  totalScore: number | null
  maxScore: number
  gradingStatus: string
  submittedAt: string
  answers: any[]
  user: { id: string; name: string | null; avatar: string | null }
  template: { id: string; name: string; icon: string | null; examTemplate?: string; examPassScore?: number }
}

export default function GradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: submissionId } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const [submission, setSubmission] = useState<GradingSubmission | null>(null)
  const [questions, setQuestions] = useState<any[]>([])
  const [grades, setGrades] = useState<Record<string, { score: number; feedback: string }>>({})
  const [gradingNote, setGradingNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => { loadSubmission() }, [submissionId])

  const loadSubmission = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/academy/exam/grading-queue')
      if (!res.ok) { router.push('/login'); return }
      const data = await res.json()
      const found = data.queue?.find((s: any) => s.id === submissionId)
      if (!found) { router.push('/academy/dashboard'); return }
      setSubmission(found)

      // 解析考试题目
      if (found.template?.examTemplate) {
        try {
          const exam = typeof found.template.examTemplate === 'string'
            ? JSON.parse(found.template.examTemplate) : found.template.examTemplate
          setQuestions(exam.questions || [])
        } catch {}
      }
    } catch { router.push('/academy/dashboard') }
    finally { setLoading(false) }
  }

  const handleGrade = async () => {
    if (!submission) return
    setSubmitting(true)
    try {
      const gradesList = Object.entries(grades).map(([qid, g]) => ({
        questionId: qid,
        manualScore: g.score,
        feedback: g.feedback,
      }))
      const res = await fetch('/api/academy/exam/grade', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, grades: gradesList, gradingNote }),
      })
      if (res.ok) {
        setSuccess('批改完成！')
        setTimeout(() => router.push('/academy/dashboard'), 2000)
      }
    } catch {}
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-5xl animate-bounce">📝</div>
      </div>
    )
  }

  if (!submission) return null

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/academy/dashboard" className="text-sm text-slate-400 hover:text-orange-400">← 返回看板</Link>
        <h1 className="mt-2 text-2xl font-bold text-white mb-1">📝 批改考试</h1>
        <p className="text-sm text-slate-400 mb-6">
          {submission.template.icon} {submission.template.name} —
          学员: {submission.user.name || '匿名'} —
          提交于 {new Date(submission.submittedAt).toLocaleString('zh-CN')}
        </p>

        {success && (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 text-sm">{success}</div>
        )}

        {/* 题目列表 */}
        <div className="space-y-6">
          {questions.map((q: any, qi: number) => {
            const answer = submission.answers?.find((a: any) => a.questionId === q.id)
            const qType = q.type === 'single' ? 'single_choice' : q.type === 'multi' ? 'multi_choice' : q.type
            const isObjective = qType === 'single_choice' || qType === 'multi_choice'
            return (
              <div key={q.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold">{qi + 1}</span>
                  <span className="text-xs text-slate-500">
                    {qType === 'single_choice' ? '单选' : qType === 'multi_choice' ? '多选' : qType === 'short_answer' ? '简答' : qType === 'essay' ? '论述' : '实操上传'}
                  </span>
                  <span className="text-xs text-slate-500">({q.points} 分)</span>
                  {isObjective && answer?.autoScore !== undefined && (
                    <span className={`text-xs ${answer.autoScore > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      自动: {answer.autoScore}/{q.points}
                    </span>
                  )}
                </div>
                <p className="text-sm text-white mb-3 whitespace-pre-wrap">{q.title}</p>

                {/* 学生答案 */}
                <div className="bg-slate-900/50 rounded-lg p-3 mb-3">
                  <p className="text-[10px] text-slate-500 mb-1">学生答案:</p>
                  {isObjective ? (
                    <p className="text-sm text-white">{Array.isArray(answer?.answer) ? answer.answer.join(', ') : answer?.answer || '未作答'}</p>
                  ) : q.type === 'practical_upload' && answer?.answer ? (
                    <a href={answer.answer} target="_blank" rel="noopener" className="text-sm text-orange-400 hover:underline">📎 查看上传文件</a>
                  ) : (
                    <p className="text-sm text-white whitespace-pre-wrap">{answer?.answer || '未作答'}</p>
                  )}
                </div>

                {/* 参考答案 */}
                {q.referenceAnswer && (
                  <div className="bg-blue-500/5 rounded-lg p-3 mb-3 border border-blue-500/20">
                    <p className="text-[10px] text-blue-400 mb-1">参考答案:</p>
                    <p className="text-xs text-slate-300 whitespace-pre-wrap">{q.referenceAnswer}</p>
                  </div>
                )}

                {/* 客观题正确答案 */}
                {isObjective && (
                  <p className="text-xs text-slate-500 mb-2">
                    正确答案: {Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer}
                  </p>
                )}

                {/* 主观题打分 */}
                {!isObjective && (
                  <div className="flex items-center gap-3 mt-2">
                    <label className="text-xs text-slate-400">评分:</label>
                    <input
                      type="number"
                      min={0}
                      max={q.points}
                      value={grades[q.id]?.score ?? ''}
                      onChange={e => setGrades(prev => ({ ...prev, [q.id]: { ...prev[q.id], score: Number(e.target.value) || 0, feedback: prev[q.id]?.feedback || '' } }))}
                      className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-orange-500"
                    />
                    <span className="text-xs text-slate-500">/ {q.points}</span>
                    <input
                      type="text"
                      value={grades[q.id]?.feedback ?? ''}
                      onChange={e => setGrades(prev => ({ ...prev, [q.id]: { ...prev[q.id], score: prev[q.id]?.score || 0, feedback: e.target.value } }))}
                      placeholder="反馈（可选）"
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 总评 + 提交 */}
        <div className="mt-6 bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="mb-3">
            <label className="text-xs text-slate-400">阅卷备注（可选）</label>
            <input
              type="text"
              value={gradingNote}
              onChange={e => setGradingNote(e.target.value)}
              placeholder="总体评价..."
              className="w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>
          <button
            onClick={handleGrade}
            disabled={submitting}
            className="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white py-2.5 rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition-all disabled:opacity-50"
          >
            {submitting ? '提交中...' : '✅ 提交批改'}
          </button>
        </div>
      </div>
    </div>
  )
}

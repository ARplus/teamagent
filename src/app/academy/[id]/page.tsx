'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LessonList } from '@/components/academy/LessonList'

interface CourseDetail {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  category: string
  tags?: string | null
  courseType?: string | null
  price?: number | null
  coverImage?: string | null
  reviewStatus: string
  isPublic: boolean
  stepsCount: number
  enrollCount: number
  creator: { id: string; name?: string | null; avatar?: string | null }
  workspace: { id: string; name?: string | null }
  createdAt: string
  steps: Array<{
    index: number
    title: string
    description?: string
    assigneeType?: string
    videoUrl?: string | null
  }>
  isEnrolled: boolean
  isCreator: boolean
  enrollment?: {
    id: string
    status: string
    progress: number
    enrolledAt: string
    completedAt?: string | null
  } | null
}

const courseTypeLabels: Record<string, string> = {
  human: '👤 人类课程',
  agent: '🤖 Agent 课程',
  both: '🤝 人机共学课程',
}

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

const reviewStatusConfig: Record<string, { label: string; color: string }> = {
  none:     { label: '草稿', color: 'bg-slate-700 text-slate-300' },
  pending:  { label: '审核中', color: 'bg-amber-500/20 text-amber-400' },
  approved: { label: '已通过', color: 'bg-emerald-500/20 text-emerald-400' },
  rejected: { label: '已驳回', color: 'bg-red-500/20 text-red-400' },
}

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [error, setError] = useState('')

  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email || '')

  useEffect(() => {
    loadCourse()
  }, [id])

  const loadCourse = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/academy/courses/${id}`)
      if (res.ok) {
        setCourse(await res.json())
      } else {
        setError('课程不存在')
      }
    } catch (e) {
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleReview = async (action: 'approve' | 'reject') => {
    setReviewing(true)
    try {
      const res = await fetch(`/api/academy/courses/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: rejectNote || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        await loadCourse()
        setShowRejectInput(false)
        setRejectNote('')
      } else {
        setError(data.error || '操作失败')
      }
    } catch {
      setError('网络错误')
    } finally {
      setReviewing(false)
    }
  }

  const handleDeleteCourse = async () => {
    if (!course) return
    if (!confirm(`确定删除课程「${course.name}」？此操作不可撤销，所有学员记录也会删除。`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/academy')
      } else {
        const data = await res.json()
        setError(data.error || '删除失败')
      }
    } catch {
      setError('删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  const handleEnroll = async () => {
    if (!session) {
      router.push('/login')
      return
    }

    setEnrolling(true)
    setError('')
    try {
      const res = await fetch('/api/academy/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: id }),
      })
      const data = await res.json()

      if (res.ok) {
        // 重新加载课程信息
        await loadCourse()
        // 如果报名成功，跳到学习页面
        if (data.enrollment?.id) {
          router.push(`/academy/learn/${data.enrollment.id}`)
        }
      } else {
        setError(data.error || '报名失败')
      }
    } catch (e) {
      setError('网络错误')
    } finally {
      setEnrolling(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🦞</div>
          <p className="mt-4 text-slate-400">加载中...</p>
        </div>
      </div>
    )
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl">😕</div>
          <p className="mt-4 text-slate-400">{error || '课程不存在'}</p>
          <Link href="/academy" className="mt-4 inline-block text-orange-400 hover:text-orange-300">
            ← 返回学院
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* 顶部返回 */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/academy" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
            ← 返回龙虾学院
          </Link>
          {(isAdmin || course.isCreator) && (
            <div className="flex items-center gap-2">
              {/* 审核状态徽章 */}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${(reviewStatusConfig[course.reviewStatus] || reviewStatusConfig.none).color}`}>
                {(reviewStatusConfig[course.reviewStatus] || reviewStatusConfig.none).label}
              </span>
              {/* 编辑按钮 */}
              <Link
                href={`/academy/create?edit=${id}`}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                ✏️ 编辑
              </Link>
              {/* Admin 专属操作 */}
              {isAdmin && (
                <>
                  {course.reviewStatus === 'pending' && !showRejectInput && (
                    <>
                      <button
                        onClick={() => handleReview('approve')}
                        disabled={reviewing}
                        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {reviewing ? '处理中...' : '✅ 通过'}
                      </button>
                      <button
                        onClick={() => setShowRejectInput(true)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        ❌ 驳回
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleDeleteCourse}
                    disabled={deleting}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    {deleting ? '删除中...' : '🗑️ 删除'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {/* 驳回备注输入框 */}
        {isAdmin && showRejectInput && (
          <div className="max-w-5xl mx-auto mt-2 flex items-center gap-2">
            <input
              type="text"
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="驳回原因（可选）"
              className="flex-1 text-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
            <button
              onClick={() => handleReview('reject')}
              disabled={reviewing}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              {reviewing ? '处理中...' : '确认驳回'}
            </button>
            <button
              onClick={() => { setShowRejectInput(false); setRejectNote('') }}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* 课程头部 */}
      <div className="bg-gradient-to-b from-slate-800/50 to-slate-900 border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* 封面图 */}
            <div className="flex-shrink-0 w-full sm:w-80">
              <div className="aspect-video bg-slate-800 rounded-2xl overflow-hidden border border-slate-700">
                {course.coverImage ? (
                  <img src={course.coverImage} alt={course.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-6xl">{course.icon || '🎓'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 课程信息 */}
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                  {courseTypeLabels[course.courseType || 'human'] || course.courseType}
                </span>
                {course.price && course.price > 0 ? (
                  <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-medium">
                    {course.price} Token
                  </span>
                ) : (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                    免费
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-white">
                {course.name}
              </h1>

              {course.description && (
                <p className="mt-3 text-slate-400 leading-relaxed">
                  {course.description}
                </p>
              )}

              <div className="mt-4 flex items-center space-x-4 text-sm text-slate-500">
                <span className="flex items-center space-x-1">
                  <span className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
                    {course.creator?.name?.[0] || '?'}
                  </span>
                  <span>{course.creator?.name || '未知'}</span>
                </span>
                <span>·</span>
                <span>{course.stepsCount} 课时</span>
                <span>·</span>
                <span>{course.enrollCount} 人学习</span>
              </div>

              {/* 报名按钮 */}
              <div className="mt-6">
                {course.isEnrolled ? (
                  <div className="flex items-center space-x-3">
                    <Link
                      href={`/academy/learn/${course.enrollment?.id}`}
                      className="bg-gradient-to-r from-orange-500 to-rose-500 text-white px-6 py-3 rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition-all shadow-lg shadow-orange-500/25"
                    >
                      {course.enrollment?.progress === 100 ? '🎓 复习课程' : '▶ 继续学习'}
                    </Link>
                    <span className="text-sm text-slate-400">
                      进度: {course.enrollment?.progress}%
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={handleEnroll}
                    disabled={enrolling}
                    className="bg-gradient-to-r from-orange-500 to-rose-500 text-white px-8 py-3 rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition-all shadow-lg shadow-orange-500/25 disabled:opacity-50"
                  >
                    {enrolling ? '报名中...' : course.price && course.price > 0
                      ? `🎟️ 报名 (${course.price} Token)`
                      : '🎟️ 免费报名'
                    }
                  </button>
                )}

                {error && (
                  <p className="mt-2 text-sm text-red-400">{error}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 课程大纲 */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
          <LessonList
            steps={course.steps}
            isEnrolled={course.isEnrolled || isAdmin || course.isCreator}
          />
        </div>
      </div>

      {/* Admin/创建者 课程内容预览 */}
      {(isAdmin || course.isCreator) && course.steps?.length > 0 && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-8">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">
              {isAdmin ? '📋 审核预览 — 课程完整内容' : '📋 课程内容预览'}
            </h3>
            <div className="space-y-6">
              {course.steps.map((step: any, i: number) => (
                <div key={i} className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-xs flex items-center justify-center font-bold">{i + 1}</span>
                    <span className="text-sm font-medium text-white">{step.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                      {step.assigneeType === 'agent' ? '🤖 Agent' : step.assigneeType === 'both' ? '🤝 共学' : '📝 人类'}
                    </span>
                  </div>
                  {step.description && (
                    <p className="text-xs text-slate-400 mb-3">{step.description}</p>
                  )}
                  {/* 视频 */}
                  {step.videoUrl && (
                    <div className="mb-3 text-xs text-cyan-400">🎬 视频: <a href={step.videoUrl} target="_blank" rel="noreferrer" className="underline hover:text-cyan-300">{step.videoUrl}</a></div>
                  )}
                  {/* HTML 课件 */}
                  {step.htmlUrl && (
                    <div className="mb-3 text-xs text-emerald-400">🌐 互动课件: <a href={step.htmlUrl} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300">{step.htmlUrl}</a></div>
                  )}
                  {/* 附件（PDF/PPT/Word）— 内嵌预览 */}
                  {step.fileUrl && (() => {
                    const url = step.fileUrl.toLowerCase()
                    const isPdf = url.endsWith('.pdf')
                    const isOffice = url.endsWith('.ppt') || url.endsWith('.pptx') || url.endsWith('.doc') || url.endsWith('.docx')
                    const fullUrl = step.fileUrl.startsWith('http') ? step.fileUrl : `${typeof window !== 'undefined' ? window.location.origin : 'https://agent.avatargaia.top'}${step.fileUrl}`
                    const viewerUrl = isOffice ? `https://docs.google.com/viewer?url=${encodeURIComponent(fullUrl)}&embedded=true` : null
                    return (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 text-xs text-violet-400 mb-1">
                          <span>📎 附件: {step.fileName || step.fileUrl.split('/').pop()}</span>
                          <a href={step.fileUrl} target="_blank" rel="noreferrer" download className="text-slate-400 underline hover:text-orange-400">⬇️ 下载</a>
                        </div>
                        {(isPdf || isOffice) && (
                          <iframe
                            src={isPdf ? step.fileUrl : viewerUrl!}
                            title={step.fileName || '附件预览'}
                            className="w-full rounded-lg border border-slate-700"
                            style={{ minHeight: '400px' }}
                            allowFullScreen
                          />
                        )}
                      </div>
                    )
                  })()}
                  {/* 文本内容 */}
                  {step.content && (
                    <div className="bg-slate-800 rounded-lg p-3 text-xs text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto border border-slate-700">
                      {step.content}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

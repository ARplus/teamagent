'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Student {
  userId: string
  name: string | null
  avatar: string | null
  email: string | null
  userType: 'human' | 'agent'
  isAgent: boolean
  agentName: string | null
  humanName: string | null
  status: string
  progress: number
  paidTokens: number
  enrolledAt: string
  completedAt: string | null
  exam: {
    submissionId: string
    totalScore: number | null
    maxScore: number
    passed: boolean
    gradingStatus: string
    submittedAt: string
  } | null
}

interface CourseData {
  id: string
  name: string
  icon: string | null
  courseType: string | null
  price: number | null
  reviewStatus: string
  stepsCount: number
  studentCount: number
  completedCount: number
  revenue: number
  students: Student[]
}

interface Summary {
  totalCourses: number
  totalStudents: number
  totalRevenue: number
  totalCompleted: number
  completionRate: number
}

export default function CreatorDashboard() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [courses, setCourses] = useState<CourseData[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null)
  const [gradingQueue, setGradingQueue] = useState<any[]>([])

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
    if (authStatus === 'authenticated') loadData()
  }, [authStatus])

  const loadData = async () => {
    setLoading(true)
    try {
      const [studentsRes, gradingRes] = await Promise.all([
        fetch('/api/academy/my-created-courses/students'),
        fetch('/api/academy/exam/grading-queue'),
      ])
      if (studentsRes.ok) {
        const data = await studentsRes.json()
        setSummary(data.summary)
        setCourses(data.courses)
      }
      if (gradingRes.ok) {
        const data = await gradingRes.json()
        setGradingQueue(data.queue || [])
      }
    } catch (e) {
      console.error('加载看板失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = (s: string) => {
    const map: Record<string, { text: string; color: string }> = {
      enrolled: { text: '已报名', color: 'text-blue-400' },
      learning: { text: '学习中', color: 'text-amber-400' },
      completed: { text: '已完成', color: 'text-emerald-400' },
      graduated: { text: '已毕业', color: 'text-emerald-400' },
    }
    return map[s] || { text: s, color: 'text-slate-400' }
  }

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">📊</div>
          <p className="mt-4 text-slate-400">加载看板...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* 顶部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/academy" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
              ← 返回龙虾学院
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-white">📊 创建者看板</h1>
          </div>
          <Link
            href="/academy/create"
            className="text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white px-4 py-2 rounded-xl hover:from-orange-600 hover:to-rose-600 transition-colors"
          >
            ✏️ 创建课程
          </Link>
        </div>

        {/* 汇总卡片 */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center">
              <div className="text-2xl font-bold text-white">{summary.totalCourses}</div>
              <div className="text-xs text-slate-400 mt-1">📘 课程数</div>
            </div>
            <Link href="/academy/dashboard/students" className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 transition-all block">
              <div className="text-2xl font-bold text-blue-400">{summary.totalStudents}</div>
              <div className="text-xs text-slate-400 mt-1">👥 总学员 →</div>
            </Link>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center">
              <div className="text-2xl font-bold text-emerald-400">{summary.completionRate}%</div>
              <div className="text-xs text-slate-400 mt-1">🎯 完课率</div>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center">
              <div className="text-2xl font-bold text-orange-400">{summary.totalRevenue}</div>
              <div className="text-xs text-slate-400 mt-1">💰 Token收入</div>
            </div>
          </div>
        )}

        {/* 待批改 */}
        {gradingQueue.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-white mb-3">📝 待批改 ({gradingQueue.length})</h2>
            <div className="space-y-2">
              {gradingQueue.map((s: any) => (
                <div key={s.id} className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{s.template?.icon || '📘'}</span>
                    <div>
                      <p className="text-sm text-white">{s.template?.name}</p>
                      <p className="text-xs text-slate-400">学员: {s.user?.name || '匿名'} · 提交于 {new Date(s.submittedAt).toLocaleString('zh-CN')}</p>
                    </div>
                  </div>
                  <Link
                    href={`/academy/grade/${s.id}`}
                    className="text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    去批改 →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 课程列表 */}
        {courses.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-5xl">🦞</span>
            <h3 className="mt-4 text-lg text-slate-300">还没有创建课程</h3>
            <p className="mt-2 text-sm text-slate-500">创建你的第一门课程，开始教学之旅！</p>
            <Link
              href="/academy/create"
              className="inline-block mt-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white px-6 py-2.5 rounded-xl text-sm"
            >
              ✏️ 创建课程
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {courses.map(course => (
              <div key={course.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                {/* 课程头 */}
                <div className="px-5 py-4 flex items-center justify-between hover:bg-slate-750 transition-colors">
                  <button
                    onClick={() => setExpandedCourse(expandedCourse === course.id ? null : course.id)}
                    className="flex items-center gap-3 text-left flex-1 min-w-0"
                  >
                    <span className="text-2xl flex-shrink-0">{course.icon || '📘'}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white truncate">{course.name}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                          course.reviewStatus === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                          course.reviewStatus === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                          course.reviewStatus === 'rejected' ? 'bg-red-500/20 text-red-400' :
                          'bg-slate-600/40 text-slate-400'
                        }`}>
                          {course.reviewStatus === 'approved' ? '已上架' :
                           course.reviewStatus === 'pending' ? '审核中' :
                           course.reviewStatus === 'rejected' ? '被驳回' : '草稿'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{course.stepsCount} 课时</span>
                        <span>👥 {course.studentCount} 学员</span>
                        <span>✅ {course.completedCount} 完课</span>
                        {course.revenue > 0 && <span className="text-orange-400">💰 {course.revenue} Token</span>}
                      </div>
                    </div>
                  </button>
                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                    {/* 编辑（草稿/被驳回/已下架可编辑） */}
                    {(course.reviewStatus === 'none' || course.reviewStatus === 'rejected') && (
                      <Link
                        href={`/academy/create?edit=${course.id}`}
                        className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
                      >
                        ✏️ 编辑
                      </Link>
                    )}
                    {/* 下架（已上架可下架） */}
                    {course.reviewStatus === 'approved' && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!confirm('确定下架此课程？下架后学员仍可继续学习，但新学员无法报名。')) return
                          try {
                            const res = await fetch(`/api/academy/courses/${course.id}/review`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'withdraw' }),
                            })
                            if (res.ok) {
                              setCourses(prev => prev.map(c => c.id === course.id ? { ...c, reviewStatus: 'none' } : c))
                            }
                          } catch {}
                        }}
                        className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-700 text-amber-400 hover:bg-amber-500/20 transition-colors"
                      >
                        📦 下架
                      </button>
                    )}
                    <span className="text-slate-500 text-sm ml-1">{expandedCourse === course.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* 学生列表（展开） */}
                {expandedCourse === course.id && (
                  <div className="border-t border-slate-700 px-5 py-4">
                    {course.students.length === 0 ? (
                      <p className="text-center text-sm text-slate-500 py-4">暂无学员报名</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-12 gap-2 text-[10px] text-slate-500 uppercase tracking-wider px-2 mb-1">
                          <div className="col-span-3">学员</div>
                          <div className="col-span-2">状态</div>
                          <div className="col-span-2">进度</div>
                          <div className="col-span-1">付费</div>
                          <div className="col-span-3">考试成绩</div>
                          <div className="col-span-1">报名</div>
                        </div>
                        {course.students.map(student => {
                          const st = statusLabel(student.status)
                          return (
                            <div key={student.userId} className="grid grid-cols-12 gap-2 items-center bg-slate-900/50 rounded-lg px-2 py-2.5 text-sm">
                              <div className="col-span-3 flex items-center gap-2">
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${
                                  student.isAgent ? 'bg-gradient-to-br from-orange-500 to-amber-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'
                                }`}>
                                  {student.isAgent ? '🤖' : (student.name?.[0] || '?')}
                                </span>
                                <div className="min-w-0">
                                  <span className="text-white text-xs truncate block">{student.name || '匿名'}</span>
                                  {student.isAgent && (
                                    <span className="text-[10px] text-slate-500 truncate block">
                                      🤖 Agent{student.humanName ? ` · ${student.humanName}` : ''}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="col-span-2">
                                <span className={`text-xs ${st.color}`}>{st.text}</span>
                              </div>
                              <div className="col-span-2">
                                <div className="flex items-center gap-1">
                                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        student.progress >= 100 ? 'bg-emerald-500' :
                                        student.progress > 0 ? 'bg-orange-500' : 'bg-slate-600'
                                      }`}
                                      style={{ width: `${student.progress}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-slate-400 w-6 text-right">{student.progress}%</span>
                                </div>
                              </div>
                              <div className="col-span-1 text-xs text-orange-400">
                                {student.paidTokens > 0 ? `${student.paidTokens}T` : <span className="text-slate-600">—</span>}
                              </div>
                              <div className="col-span-3">
                                {student.exam ? (
                                  <div className="flex items-center gap-1.5">
                                    {student.exam.gradingStatus === 'pending' ? (
                                      <span className="text-[10px] text-slate-500">待批改</span>
                                    ) : student.exam.gradingStatus === 'manual_grading' ? (
                                      <span className="text-[10px] text-amber-400">待阅卷</span>
                                    ) : (
                                      <span className={`text-xs font-medium ${student.exam.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {student.exam.passed ? '✓' : '✗'} {student.exam.totalScore ?? '—'}/{student.exam.maxScore}
                                      </span>
                                    )}
                                    <Link
                                      href={`/academy/grade/${student.exam.submissionId}`}
                                      className="text-[10px] text-slate-500 hover:text-orange-400 transition-colors"
                                    >
                                      查看→
                                    </Link>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-600">未提交</span>
                                )}
                              </div>
                              <div className="col-span-1 text-[10px] text-slate-500">
                                {formatDate(student.enrolledAt)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

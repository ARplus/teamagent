'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface AgentInfo {
  userId: string
  userName: string | null
  agentName: string
  avatar: string | null
  status: string | null
  capabilities: string[]
}

interface Stats {
  totalEnrolled: number
  totalGraduated: number
  totalPrinciples: number
  avgScore: number | null
}

interface ExamInfo {
  id: string
  totalScore: number | null
  maxScore: number
  passed: boolean | null
  gradingStatus: string
  submittedAt: string
}

interface GraduatedCourse {
  enrollmentId: string
  course: {
    id: string
    name: string
    icon: string | null
    courseType: string | null
    difficulty: string | null
    creator: { id: string; name: string | null; avatar: string | null }
  }
  completedAt: string | null
  principleDelivered: boolean
  exam: ExamInfo | null
}

interface InProgressCourse {
  enrollmentId: string
  course: {
    id: string
    name: string
    icon: string | null
    difficulty: string | null
  }
  progress: number
  enrolledAt: string
}

interface UnlockedPrinciple {
  courseId: string
  courseName: string
  courseIcon: string | null
  principleTitle: string
  unlockedAt: string | null
}

interface ProfileData {
  agent: AgentInfo
  stats: Stats
  graduated: GraduatedCourse[]
  inProgress: InProgressCourse[]
  unlockedPrinciples: UnlockedPrinciple[]
}

const difficultyLabel: Record<string, { text: string; color: string }> = {
  beginner: { text: '入门', color: 'text-emerald-400 bg-emerald-400/10' },
  intermediate: { text: '进阶', color: 'text-blue-400 bg-blue-400/10' },
  advanced: { text: '认证', color: 'text-purple-400 bg-purple-400/10' },
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function AgentProfileContent() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'graduated' | 'inProgress' | 'principles'>('graduated')

  const userId = searchParams.get('userId') || undefined

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
    if (authStatus === 'authenticated') loadProfile()
  }, [authStatus, userId])

  const loadProfile = async () => {
    setLoading(true)
    setError(null)
    try {
      const url = userId ? `/api/academy/agent-profile?userId=${userId}` : '/api/academy/agent-profile'
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || '加载失败')
        return
      }
      setData(await res.json())
    } catch (e) {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🤖</div>
          <p className="mt-4 text-slate-400">加载档案中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl">😵</div>
          <p className="mt-4 text-red-400">{error}</p>
          <Link href="/academy" className="mt-4 inline-block text-sm text-slate-400 hover:text-orange-400">← 返回学院</Link>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { agent, stats, graduated, inProgress, unlockedPrinciples } = data

  const statusColors: Record<string, string> = {
    online: 'bg-emerald-500',
    working: 'bg-blue-500',
    idle: 'bg-yellow-500',
    offline: 'bg-slate-500',
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Back */}
        <Link href="/academy" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
          ← 返回龙虾学院
        </Link>

        {/* Agent Card */}
        <div className="mt-4 bg-gradient-to-br from-slate-800 to-slate-800/60 border border-slate-700 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-2xl font-bold text-white overflow-hidden">
                {agent.avatar ? (
                  <img src={agent.avatar} alt={agent.agentName} className="w-full h-full object-cover" />
                ) : (
                  '🤖'
                )}
              </div>
              {agent.status && (
                <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-800 ${statusColors[agent.status] || 'bg-slate-500'}`} />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white">{agent.agentName}</h1>
              {agent.userName && agent.userName !== agent.agentName && (
                <p className="text-sm text-slate-400">{agent.userName}</p>
              )}
              {agent.capabilities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {agent.capabilities.slice(0, 6).map((cap, i) => (
                    <span key={i} className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{cap}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Stats Row */}
          <div className="mt-5 grid grid-cols-4 gap-3 pt-5 border-t border-slate-700">
            <div className="text-center">
              <div className="text-xl font-bold text-white">{stats.totalEnrolled}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">报名课程</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-emerald-400">{stats.totalGraduated}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">已毕业</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-purple-400">{stats.totalPrinciples}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Principle</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-orange-400">
                {stats.avgScore != null ? `${stats.avgScore}` : '—'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">均分</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 bg-slate-800/60 rounded-xl p-1 border border-slate-700">
          {[
            { key: 'graduated', label: `已毕业 ${graduated.length}`, icon: '🎓' },
            { key: 'inProgress', label: `学习中 ${inProgress.length}`, icon: '📖' },
            { key: 'principles', label: `Principle ${unlockedPrinciples.length}`, icon: '✨' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex-1 text-xs py-2 rounded-lg transition-colors font-medium ${
                activeTab === tab.key
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="mt-4 space-y-3">
          {/* Graduated */}
          {activeTab === 'graduated' && (
            <>
              {graduated.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-4xl">🎓</div>
                  <p className="mt-3 text-sm">还没有毕业课程</p>
                </div>
              ) : (
                graduated.map(item => {
                  const diff = item.course.difficulty ? difficultyLabel[item.course.difficulty] : null
                  return (
                    <div key={item.enrollmentId} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl flex-shrink-0">{item.course.icon || '📘'}</span>
                          <div>
                            <h3 className="text-sm font-medium text-white">{item.course.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              {diff && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${diff.color}`}>{diff.text}</span>
                              )}
                              {item.completedAt && (
                                <span className="text-[10px] text-slate-500">完成于 {formatDate(item.completedAt)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span className="text-xs text-emerald-400 font-medium">已毕业 ✓</span>
                          {item.principleDelivered && (
                            <span className="text-[10px] text-purple-400">✨ Principle 已解锁</span>
                          )}
                        </div>
                      </div>

                      {/* Exam Result */}
                      {item.exam && (
                        <div className="mt-3 pt-3 border-t border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">考试成绩</span>
                            <div className="flex items-center gap-2">
                              {item.exam.gradingStatus === 'pending' ? (
                                <span className="text-[10px] text-slate-400">待批改</span>
                              ) : item.exam.gradingStatus === 'manual_grading' ? (
                                <span className="text-[10px] text-amber-400">待阅卷</span>
                              ) : (
                                <>
                                  <span className={`text-sm font-semibold ${item.exam.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {item.exam.passed ? '✓ 通过' : '✗ 未通过'}
                                  </span>
                                  <span className="text-xs text-slate-400">
                                    {item.exam.totalScore ?? '—'} / {item.exam.maxScore} 分
                                  </span>
                                </>
                              )}
                              <Link
                                href={`/academy/grade/${item.exam.id}`}
                                className="text-[10px] text-slate-500 hover:text-orange-400 transition-colors"
                              >
                                详情→
                              </Link>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </>
          )}

          {/* In Progress */}
          {activeTab === 'inProgress' && (
            <>
              {inProgress.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-4xl">📖</div>
                  <p className="mt-3 text-sm">没有进行中的课程</p>
                </div>
              ) : (
                inProgress.map(item => {
                  const diff = item.course.difficulty ? difficultyLabel[item.course.difficulty] : null
                  return (
                    <div key={item.enrollmentId} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl flex-shrink-0">{item.course.icon || '📘'}</span>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-white truncate">{item.course.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            {diff && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${diff.color}`}>{diff.text}</span>
                            )}
                            <span className="text-[10px] text-slate-500">报名 {formatDate(item.enrolledAt)}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <div className="text-sm font-semibold text-orange-400">{item.progress}%</div>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            item.progress >= 100 ? 'bg-emerald-500' : item.progress > 0 ? 'bg-orange-500' : 'bg-slate-600'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}

          {/* Principles */}
          {activeTab === 'principles' && (
            <>
              {unlockedPrinciples.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-4xl">✨</div>
                  <p className="mt-3 text-sm">还没有解锁 Principle</p>
                  <p className="mt-1 text-xs">完成课程并通过考试后解锁专属知识文件</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500 px-1">Principle 是毕业后解锁的专属知识文件，注入 Agent 的长期记忆。</p>
                  {unlockedPrinciples.map(p => (
                    <div key={p.courseId} className="bg-gradient-to-r from-purple-500/10 to-slate-800 border border-purple-500/20 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl flex-shrink-0">{p.courseIcon || '📘'}</span>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-purple-300">{p.principleTitle}</h3>
                          <p className="text-[10px] text-slate-500 mt-0.5">来自课程：{p.courseName}</p>
                          {p.unlockedAt && (
                            <p className="text-[10px] text-slate-600 mt-0.5">解锁于 {formatDate(p.unlockedAt)}</p>
                          )}
                        </div>
                        <span className="text-lg flex-shrink-0">✨</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AgentProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-5xl animate-bounce">🤖</div>
      </div>
    }>
      <AgentProfileContent />
    </Suspense>
  )
}

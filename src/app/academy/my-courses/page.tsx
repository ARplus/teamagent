'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface MyCourse {
  enrollmentId: string
  status: string
  progress: number
  paidTokens: number
  enrolledAt: string
  completedAt?: string | null
  learners?: Array<{
    type: 'human' | 'agent'
    name: string
    agentId?: string
  }>
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
    difficulty?: string | null
    department?: string | null
    tags?: string | null
    creator?: { name?: string | null; agent?: { name?: string | null } | null } | null
    workspace?: { name?: string | null } | null
  }
  examSubmission?: {
    id: string
    gradingStatus: string
    passed: boolean | null
  } | null
  task?: {
    id: string
    status: string
    steps: Array<{ id: string; title: string; status: string; order: number }>
  } | null
}

type TabId = 'learning' | 'completed'

export default function MyCoursesPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [courses, setCourses] = useState<MyCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('learning')

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login')
    } else if (authStatus === 'authenticated') {
      loadCourses()
    }
  }, [authStatus])

  const loadCourses = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/academy/my-courses')
      if (res.ok) {
        const data = await res.json()
        setCourses(data.courses || [])
      }
    } catch (e) {
      console.error('加载我的课程失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const learningCourses = courses.filter(c => c.status !== 'completed' && c.status !== 'graduated')
  const completedCourses = courses.filter(c => c.status === 'completed' || c.status === 'graduated')
  const displayCourses = activeTab === 'learning' ? learningCourses : completedCourses

  const courseTypeIcons: Record<string, string> = {
    human: '👤',
    agent: '🤖',
    both: '🤝',
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/academy" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
              ← 返回龙虾学院
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-white">📖 我的课程</h1>
          </div>
          <Link
            href="/academy"
            className="text-sm bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 px-4 py-2 rounded-xl transition-colors"
          >
            探索更多课程
          </Link>
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center space-x-1 mb-6 bg-slate-800 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('learning')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'learning'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            学习中 ({learningCourses.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'completed'
                ? 'bg-emerald-500 text-white shadow-lg'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            已完成 ({completedCourses.length})
          </button>
        </div>

        {/* 课程列表 */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-slate-800 rounded-2xl border border-slate-700 p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-32 h-20 bg-slate-700 rounded-xl flex-shrink-0" />
                  <div className="flex-1 space-y-3">
                    <div className="h-5 bg-slate-700 rounded w-1/2" />
                    <div className="h-4 bg-slate-700 rounded w-3/4" />
                    <div className="h-3 bg-slate-700 rounded w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayCourses.length > 0 ? (
          <div className="space-y-4">
            {displayCourses.map((item) => (
              <Link
                key={item.enrollmentId}
                href={`/academy/learn/${item.enrollmentId}`}
                className="block bg-slate-800 rounded-2xl border border-slate-700 p-4 hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/5 transition-all group"
              >
                <div className="flex gap-4">
                  {/* 封面 */}
                  <div className="w-32 h-20 sm:w-40 sm:h-24 bg-slate-700 rounded-xl overflow-hidden flex-shrink-0">
                    {item.course.coverImage ? (
                      <img src={item.course.coverImage} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl">
                        {item.course.icon || '🎓'}
                      </div>
                    )}
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-xs text-slate-500">
                        {courseTypeIcons[item.course.courseType || 'human']}
                      </span>
                      <h3 className="text-base font-semibold text-white group-hover:text-orange-400 truncate transition-colors">
                        {item.course.name}
                      </h3>
                      {item.learners?.map((l, i) => (
                        <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                          l.type === 'agent'
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-purple-500/20 text-purple-400'
                        }`}>
                          {l.type === 'agent' ? '🤖' : '👤'} {l.name}
                        </span>
                      ))}
                    </div>

                    {item.course.description && (
                      <p className="text-sm text-slate-400 line-clamp-1 mb-2">
                        {item.course.description}
                      </p>
                    )}

                    {/* 进度条 */}
                    <div className="flex items-center space-x-3">
                      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden max-w-xs">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            item.progress >= 100
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                              : 'bg-gradient-to-r from-orange-500 to-rose-500'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">{item.progress}%</span>
                    </div>

                    {/* 标签行 */}
                    <div className="mt-1.5 flex items-center flex-wrap gap-1.5">
                      {item.course.creator && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">
                          👤 {item.course.creator.agent?.name || item.course.creator.name || '匿名'}
                        </span>
                      )}
                      {item.course.difficulty && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          item.course.difficulty === 'beginner' ? 'bg-emerald-500/20 text-emerald-400' :
                          item.course.difficulty === 'intermediate' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-purple-500/20 text-purple-400'
                        }`}>
                          {item.course.difficulty === 'beginner' ? '🌱 入门' : item.course.difficulty === 'intermediate' ? '🚀 进阶' : '💎 认证'}
                        </span>
                      )}
                      {item.course.department && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
                          {item.course.department}
                        </span>
                      )}
                      {(() => {
                        try { const t = JSON.parse(item.course.tags || '[]'); return t.slice(0, 2).map((tag: string) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">{tag}</span>
                        )) } catch { return null }
                      })()}
                    </div>

                    <div className="mt-1.5 flex items-center space-x-3 text-xs text-slate-500">
                      <span>{item.course.stepsCount} 课时</span>
                      {item.paidTokens > 0 && (
                        <span>已付 {item.paidTokens} Token</span>
                      )}
                      <span>
                        {new Date(item.enrolledAt).toLocaleDateString('zh-CN')} 报名
                      </span>
                    </div>
                  </div>

                  {/* 继续/证书/考卷按钮 */}
                  <div className="hidden sm:flex items-center gap-2">
                    {item.status === 'graduated' ? (
                      <>
                        <span
                          onClick={(e) => { e.preventDefault(); window.location.href = `/academy/certificate/${item.enrollmentId}` }}
                          className="text-sm text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                        >
                          🏆 证书
                        </span>
                        {item.examSubmission && (
                          <span
                            onClick={(e) => { e.preventDefault(); window.location.href = `/academy/exam-result/${item.enrollmentId}` }}
                            className="text-sm text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                          >
                            📋 考卷
                          </span>
                        )}
                      </>
                    ) : item.progress >= 100 ? (
                      <span className="text-xs text-amber-400">📝 待考试</span>
                    ) : null}
                    <span className="text-sm text-orange-400 group-hover:text-orange-300 font-medium">
                      {item.status === 'graduated' ? '复习 →' : item.progress >= 100 ? '去考试 →' : '继续 →'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <span className="text-5xl">{activeTab === 'learning' ? '📚' : '🎓'}</span>
            <h3 className="mt-4 text-lg font-medium text-slate-300">
              {activeTab === 'learning' ? '还没有在学的课程' : '还没有完成的课程'}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {activeTab === 'learning' ? '去学院发现感兴趣的课程吧！' : '继续学习已报名的课程'}
            </p>
            <Link
              href="/academy"
              className="mt-4 inline-block text-orange-400 hover:text-orange-300"
            >
              探索课程 →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

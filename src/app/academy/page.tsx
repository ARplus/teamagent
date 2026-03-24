'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CourseCard } from '@/components/academy/CourseCard'

interface Course {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  courseType?: string | null
  price?: number | null
  coverImage?: string | null
  school?: string | null
  department?: string | null
  stepsCount: number
  enrollCount: number
  contentTypes?: string[]
  creator?: { name?: string | null; avatar?: string | null; agent?: { name?: string | null; avatar?: string | null } | null } | null
  likeCount?: number
  workspace?: { id?: string | null; name?: string | null; type?: string | null; orgType?: string | null } | null
}

interface SchoolSection {
  school: string
  courses: Course[]
}

interface MyCreatedCourse {
  id: string
  name: string
  icon?: string | null
  courseType?: string | null
  price?: number | null
  isDraft: boolean
  reviewStatus: string | null
  reviewNote?: string | null
  stepsCount: number
  enrollCount: number
  createdAt: string
}

const courseTypes = [
  { value: '', label: '全部', icon: '📚' },
  { value: 'human', label: '人类课', icon: '🧑' },
  { value: 'agent', label: 'Agent课', icon: '🤖' },
  { value: 'both', label: '共学课', icon: '🤝' },
]

const levels = [
  { value: '', label: '全部阶段', icon: '📖' },
  { value: 'beginner', label: '入门必修', icon: '🌱' },
  { value: 'intermediate', label: '进阶提升', icon: '🚀' },
  { value: 'professional', label: '专业认证', icon: '💎' },
]

export default function AcademyPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [courseType, setCourseType] = useState('')
  const [category, setCategory] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [school, setSchool] = useState('')
  const [department, setDepartment] = useState('')
  const [sort, setSort] = useState('newest')
  const [availableSchools, setAvailableSchools] = useState<string[]>([])
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([])
  const [availableOrgs, setAvailableOrgs] = useState<{ id: string; name: string; type: string; orgType?: string | null; orgName?: string | null }[]>([])
  const [orgId, setOrgId] = useState('')
  const [schoolSections, setSchoolSections] = useState<SchoolSection[]>([])
  const [myCreated, setMyCreated] = useState<MyCreatedCourse[]>([])
  const [loadingMyCreated, setLoadingMyCreated] = useState(false)
  const [myCreatedExpanded, setMyCreatedExpanded] = useState(false)

  useEffect(() => {
    loadCourses()
  }, [courseType, difficulty, category, school, department, sort, orgId])

  // 登录后加载我创建的课程
  useEffect(() => {
    if (session) loadMyCreated()
  }, [session])

  const loadCourses = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (courseType) params.set('courseType', courseType)
      if (difficulty) params.set('difficulty', difficulty)
      if (category) params.set('category', category)
      if (searchQuery) params.set('q', searchQuery)
      if (school) params.set('school', school)
      if (department) params.set('department', department)
      if (sort) params.set('sort', sort)
      if (orgId) params.set('workspaceId', orgId)

      const res = await fetch(`/api/academy/courses?${params}`)
      if (res.ok) {
        const data = await res.json()
        setCourses(data.courses || [])
        if (data.filters) {
          setAvailableSchools(data.filters.schools || [])
          setAvailableDepartments(data.filters.departments || [])
          setAvailableOrgs(data.filters.organizations || [])
        }
        setSchoolSections(data.schoolSections || [])
      }
    } catch (e) {
      console.error('加载课程失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadMyCreated = async () => {
    setLoadingMyCreated(true)
    try {
      const res = await fetch('/api/academy/my-created-courses')
      if (res.ok) {
        const data = await res.json()
        setMyCreated(data.courses || [])
      }
    } catch (e) {
      console.error('加载我创建的课程失败:', e)
    } finally {
      setLoadingMyCreated(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadCourses()
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    draft: { label: '草稿', color: 'text-slate-400', bg: 'bg-slate-700' },
    none: { label: '草稿', color: 'text-slate-400', bg: 'bg-slate-700' },
    pending: { label: '审核中', color: 'text-amber-400', bg: 'bg-amber-500/20' },
    approved: { label: '已上线', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
    rejected: { label: '被驳回', color: 'text-red-400', bg: 'bg-red-500/20' },
  }

  const getStatus = (c: MyCreatedCourse) => {
    if (c.isDraft) return statusConfig.draft
    return statusConfig[c.reviewStatus || 'none'] || statusConfig.none
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Hero Banner */}
      <div className="relative bg-gradient-to-br from-slate-900 via-orange-950/30 to-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="mb-6">
            <a href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-orange-400 transition-colors">
              <span>←</span><span>返回首页</span>
            </a>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-4">
              <span className="text-6xl sm:text-8xl">🦞</span>
              <div>
                <h1 className="text-3xl sm:text-5xl font-bold text-left">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-rose-400">
                    龙虾学院
                  </span>
                </h1>
                <p className="text-sm sm:text-base font-light tracking-[0.3em] text-orange-400/50 uppercase text-left">
                  Claw Academy
                </p>
              </div>
            </div>
            <p className="mt-3 text-lg text-white font-semibold max-w-2xl mx-auto">
              大模型需要训练、Agent 需要教育！
            </p>
            <p className="mt-1 text-sm text-slate-500 max-w-2xl mx-auto tracking-wide">
              LLMs need training · Agents need education
            </p>

            {/* 搜索栏 */}
            <form onSubmit={handleSearch} className="mt-6 max-w-lg mx-auto">
              <div className="flex items-center bg-slate-800 rounded-xl border border-slate-700 overflow-hidden focus-within:border-orange-500/50">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索课程..."
                  className="flex-1 bg-transparent px-4 py-3 text-white placeholder-slate-500 outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-3 text-orange-400 hover:text-orange-300 transition-colors"
                >
                  🔍
                </button>
              </div>
            </form>

            {/* 快捷入口 */}
            {session && (
              <div className="mt-4 flex items-center justify-center space-x-3">
                <Link
                  href="/academy/my-courses"
                  className="text-sm text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/50 px-4 py-2 rounded-xl transition-colors"
                >
                  📖 我的课程
                </Link>
                <Link
                  href="/academy/dashboard"
                  className="text-sm text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 px-4 py-2 rounded-xl transition-colors"
                >
                  📊 创建者看板
                </Link>
                <Link
                  href="/academy/create"
                  className="text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 px-4 py-2 rounded-xl transition-colors shadow-lg shadow-orange-500/25"
                >
                  ✏️ 创建课程
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 龙虾学院特色宣传横幅 */}
      <div className="border-b border-slate-800 bg-gradient-to-r from-emerald-950/30 via-slate-900 to-emerald-950/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-center gap-3">
          <span className="text-emerald-400 text-sm">✨</span>
          <span className="text-slate-300 text-sm">人机共学的新范式 — 人类学视频，Agent 学模板</span>
          <a
            href="https://agent.avatargaia.top/uploads/html/lobster-academy-poster.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-sm text-emerald-400 border border-emerald-500/40 hover:border-emerald-400/70 hover:bg-emerald-500/10 px-3 py-1 rounded-lg transition-all"
          >
            了解龙虾学院 →
          </a>
        </div>
      </div>

      {/* 合作机构 logo 条 */}
      {availableOrgs.length > 0 && (
        <div className="border-b border-slate-800 bg-slate-900/80 py-4">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-center gap-6 sm:gap-10 flex-wrap">
              <span className="text-[10px] text-slate-600 uppercase tracking-widest flex-shrink-0">合作机构</span>
              {availableOrgs.map(org => (
                <button
                  key={org.id}
                  onClick={() => { setOrgId(org.id); window.scrollTo({ top: 600, behavior: 'smooth' }) }}
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-orange-400 transition-colors group"
                >
                  <span className="text-base">{org.orgType === 'academy' ? '🏫' : org.orgType === 'enterprise' ? '🏢' : '🎨'}</span>
                  <span className="font-medium group-hover:text-orange-400">{org.orgName || org.name.replace(/的工作区$/, '')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 我创建的课程 */}
      {session && myCreated.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setMyCreatedExpanded(!myCreatedExpanded)}
              className="flex items-center gap-2 group"
            >
              <h2 className="text-lg font-bold text-white">✏️ 我创建的课程</h2>
              <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">{myCreated.length}</span>
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${myCreatedExpanded ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <Link
              href="/academy/create"
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              + 新建课程
            </Link>
          </div>
          {myCreatedExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
            {myCreated.map((c) => {
              const st = getStatus(c)
              const isDraft = c.isDraft || !c.reviewStatus || c.reviewStatus === 'none'
              return (
                <div
                  key={c.id}
                  className="bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-orange-500/50 transition-all group"
                >
                  <Link href={`/academy/create?edit=${c.id}`} className="block">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-2xl">{c.icon || '📘'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-orange-400 truncate transition-colors">
                      {c.name}
                    </h3>
                    <div className="mt-2 flex items-center space-x-3 text-xs text-slate-500">
                      <span>{c.stepsCount} 课时</span>
                      <span>{c.enrollCount} 报名</span>
                      {c.price ? <span>{c.price} Token</span> : <span>免费</span>}
                    </div>
                    {c.reviewStatus === 'rejected' && c.reviewNote && (
                      <div className="mt-2 text-xs text-red-400/80 bg-red-500/10 px-2 py-1 rounded">
                        驳回: {c.reviewNote}
                      </div>
                    )}
                  </Link>
                  {isDraft && (
                    <button
                      onClick={() => {
                        const msg = encodeURIComponent(`我有一门新课程《${c.name}》草稿已准备好，请帮我审核并发布`)
                        router.push(`/chat?msg=${msg}`)
                      }}
                      className="mt-3 w-full text-xs py-1.5 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 hover:text-orange-300 border border-orange-500/20 transition-all"
                    >
                      📢 呼叫 Agent 发布
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          )}
          <div className="border-b border-slate-800 mb-2" />
        </div>
      )}

      {/* 主要内容 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* 筛选栏 */}
        <div className="space-y-4 mb-8">
          {/* 学习阶段（主分类）*/}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500 uppercase tracking-widest">学习阶段</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSort('newest')}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
                    sort === 'newest' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  🕐 最新
                </button>
                <button
                  onClick={() => setSort('hot')}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
                    sort === 'hot' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  🔥 热门
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {levels.map((lv) => (
                <button
                  key={lv.value}
                  onClick={() => setDifficulty(difficulty === lv.value ? '' : lv.value)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    difficulty === lv.value
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                      : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700'
                  }`}
                >
                  <span>{lv.icon}</span>
                  <span>{lv.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 行业领域 chips */}
          {availableDepartments.length > 0 && (
            <div>
              <span className="text-xs text-slate-500 uppercase tracking-widest block mb-2">行业领域</span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setDepartment('')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    !department
                      ? 'bg-slate-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                  }`}
                >
                  全部
                </button>
                {availableDepartments.map(d => (
                  <button
                    key={d}
                    onClick={() => setDepartment(d === department ? '' : d)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                      department === d
                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                        : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 课程类型 + 组织筛选（次要，折叠成一行）*/}
          <div className="flex items-center gap-2 flex-wrap">
            {courseTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => setCourseType(type.value)}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  courseType === type.value
                    ? 'bg-slate-600 text-white'
                    : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 border border-slate-700/50'
                }`}
              >
                <span>{type.icon}</span>
                <span>{type.label}</span>
              </button>
            ))}
            {availableOrgs.length > 0 && (
              <>
                <span className="text-slate-700">|</span>
                {availableOrgs.map(org => (
                  <button
                    key={org.id}
                    onClick={() => setOrgId(orgId === org.id ? '' : org.id)}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                      orgId === org.id
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 border border-slate-700/50'
                    }`}
                  >
                    <span>{org.orgType === 'academy' ? '🏫' : org.orgType === 'enterprise' ? '🏢' : '🎨'}</span>
                    <span>{org.orgName || org.name.replace(/的工作区$/, '')}</span>
                  </button>
                ))}
              </>
            )}
            {availableSchools.length > 0 && (
              <select
                value={school}
                onChange={e => setSchool(e.target.value)}
                className="bg-slate-800/50 border border-slate-700/50 text-xs text-slate-400 rounded-full px-3 py-1 focus:outline-none focus:border-orange-500"
              >
                <option value="">🏫 全部学校</option>
                {availableSchools.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            {(school || department || courseType || category || difficulty || orgId) && (
              <button
                onClick={() => { setSchool(''); setDepartment(''); setCourseType(''); setCategory(''); setDifficulty(''); setOrgId('') }}
                className="text-xs text-slate-500 hover:text-rose-400 transition-colors ml-1"
              >
                ✕ 清除全部
              </button>
            )}
          </div>
        </div>

        {/* 🏫 按学校浏览 */}
        {schoolSections.length > 0 && !school && !department && !courseType && !category && (
          <div className="mb-10 space-y-8">
            {schoolSections.map((section) => (
              <div key={section.school}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="w-8 h-8 bg-blue-500/15 text-blue-400 rounded-lg flex items-center justify-center text-sm">🏫</span>
                    {section.school}
                    <span className="text-xs font-normal text-slate-500 ml-1">({section.courses.length} 门课程)</span>
                  </h2>
                  <button
                    onClick={() => setSchool(section.school)}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    查看全部 →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {section.courses.slice(0, 3).map((course) => (
                    <CourseCard key={course.id} course={course} />
                  ))}
                </div>
              </div>
            ))}
            <div className="border-b border-slate-800" />
          </div>
        )}

        {/* 全部课程标题 */}
        {schoolSections.length > 0 && !school && !department && !courseType && (
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-8 h-8 bg-orange-500/15 text-orange-400 rounded-lg flex items-center justify-center text-sm">📚</span>
            全部课程
          </h2>
        )}

        {/* 课程网格 */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden animate-pulse">
                <div className="aspect-video bg-slate-700" />
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-slate-700 rounded w-3/4" />
                  <div className="h-4 bg-slate-700 rounded w-full" />
                  <div className="h-3 bg-slate-700 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : courses.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <span className="text-6xl">🦞</span>
            <h3 className="mt-4 text-lg font-medium text-slate-300">
              {searchQuery ? '没有找到相关课程' : '暂无课程'}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {searchQuery ? '试试其他关键词' : '各高校正在准备精彩课程，敬请期待！'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

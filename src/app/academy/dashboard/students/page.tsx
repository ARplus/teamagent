'use client'

import { useState, useEffect, useMemo } from 'react'
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
    passed: boolean | null
    gradingStatus: string
    submittedAt: string
  } | null
  // 附加：所属课程信息
  courseName: string
  courseIcon: string | null
  courseId: string
}

interface CourseData {
  id: string
  name: string
  icon: string | null
  courseType: string | null
  price: number | null
  studentCount: number
  students: any[]
}

type SortField = 'enrolledAt' | 'name' | 'progress' | 'score' | 'paidTokens'
type SortDir = 'asc' | 'desc'

export default function StudentsPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [courseNames, setCourseNames] = useState<string[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'human' | 'agent'>('all')
  const [courseFilter, setCourseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paidFilter, setPaidFilter] = useState<'all' | 'paid' | 'free'>('all')
  const [scoreMin, setScoreMin] = useState('')
  const [scoreMax, setScoreMax] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Sort
  const [sortField, setSortField] = useState<SortField>('enrolledAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Pagination
  const [page, setPage] = useState(1)
  const pageSize = 30

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
    if (authStatus === 'authenticated') loadData()
  }, [authStatus])

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/academy/my-created-courses/students')
      if (!res.ok) { router.push('/login'); return }
      const data = await res.json()
      const courses: CourseData[] = data.courses || []

      // 展平：每个 student 附上课程信息
      const flat: Student[] = []
      const names: string[] = []
      for (const c of courses) {
        names.push(c.name)
        for (const s of c.students) {
          flat.push({
            ...s,
            courseName: c.name,
            courseIcon: c.icon,
            courseId: c.id,
          })
        }
      }
      setAllStudents(flat)
      setCourseNames([...new Set(names)])
    } catch (e) {
      console.error('加载学员列表失败:', e)
    } finally {
      setLoading(false)
    }
  }

  // 筛选 + 排序
  const filtered = useMemo(() => {
    let list = [...allStudents]

    // 关键字搜索（名字/邮箱/Agent名）
    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(kw) ||
        (s.email || '').toLowerCase().includes(kw) ||
        (s.agentName || '').toLowerCase().includes(kw) ||
        (s.humanName || '').toLowerCase().includes(kw)
      )
    }

    // 类型
    if (typeFilter !== 'all') {
      list = list.filter(s => typeFilter === 'agent' ? s.isAgent : !s.isAgent)
    }

    // 课程
    if (courseFilter) {
      list = list.filter(s => s.courseName === courseFilter)
    }

    // 状态
    if (statusFilter) {
      list = list.filter(s => s.status === statusFilter)
    }

    // 付费
    if (paidFilter === 'paid') {
      list = list.filter(s => s.paidTokens > 0)
    } else if (paidFilter === 'free') {
      list = list.filter(s => s.paidTokens === 0)
    }

    // 考试分值区间
    if (scoreMin !== '') {
      const min = Number(scoreMin)
      list = list.filter(s => s.exam && s.exam.totalScore !== null && s.exam.totalScore >= min)
    }
    if (scoreMax !== '') {
      const max = Number(scoreMax)
      list = list.filter(s => s.exam && s.exam.totalScore !== null && s.exam.totalScore <= max)
    }

    // 报名时间
    if (dateFrom) {
      const from = new Date(dateFrom)
      list = list.filter(s => new Date(s.enrolledAt) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59')
      list = list.filter(s => new Date(s.enrolledAt) <= to)
    }

    // 排序
    list.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'enrolledAt':
          cmp = new Date(a.enrolledAt).getTime() - new Date(b.enrolledAt).getTime()
          break
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '')
          break
        case 'progress':
          cmp = a.progress - b.progress
          break
        case 'score':
          cmp = (a.exam?.totalScore ?? -1) - (b.exam?.totalScore ?? -1)
          break
        case 'paidTokens':
          cmp = a.paidTokens - b.paidTokens
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return list
  }, [allStudents, search, typeFilter, courseFilter, statusFilter, paidFilter, scoreMin, scoreMax, dateFrom, dateTo, sortField, sortDir])

  // 分页
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  // 重置页码 when filters change
  useEffect(() => { setPage(1) }, [search, typeFilter, courseFilter, statusFilter, paidFilter, scoreMin, scoreMax, dateFrom, dateTo])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return '↕'
    return sortDir === 'desc' ? '↓' : '↑'
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

  const clearFilters = () => {
    setSearch(''); setTypeFilter('all'); setCourseFilter(''); setStatusFilter('')
    setPaidFilter('all'); setScoreMin(''); setScoreMax(''); setDateFrom(''); setDateTo('')
  }

  const hasFilters = search || typeFilter !== 'all' || courseFilter || statusFilter || paidFilter !== 'all' || scoreMin || scoreMax || dateFrom || dateTo

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">👥</div>
          <p className="mt-4 text-slate-400">加载学员数据...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/academy/dashboard" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
              ← 返回看板
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-white">👥 学员管理</h1>
            <p className="text-sm text-slate-500 mt-1">
              共 {allStudents.length} 条报名记录{filtered.length !== allStudents.length && `，筛选后 ${filtered.length} 条`}
            </p>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">筛选条件</h3>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-orange-400 hover:text-orange-300">
                清除全部
              </button>
            )}
          </div>

          {/* Row 1: 搜索 + 类型 + 课程 + 状态 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">搜索学员</label>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="名字 / 邮箱 / Agent名..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">学员类型</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as any)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                <option value="all">全部</option>
                <option value="human">👤 人类</option>
                <option value="agent">🤖 Agent</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">课程</label>
              <select
                value={courseFilter}
                onChange={e => setCourseFilter(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                <option value="">全部课程</option>
                {courseNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">学习状态</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                <option value="">全部状态</option>
                <option value="enrolled">已报名</option>
                <option value="learning">学习中</option>
                <option value="completed">已完成</option>
                <option value="graduated">已毕业</option>
              </select>
            </div>
          </div>

          {/* Row 2: 付费 + 分值 + 时间 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">付费情况</label>
              <select
                value={paidFilter}
                onChange={e => setPaidFilter(e.target.value as any)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                <option value="all">全部</option>
                <option value="paid">💰 已付费</option>
                <option value="free">免费</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">考试分值区间</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={scoreMin}
                  onChange={e => setScoreMin(e.target.value)}
                  placeholder="最低"
                  min={0}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                />
                <span className="text-slate-500 text-xs">~</span>
                <input
                  type="number"
                  value={scoreMax}
                  onChange={e => setScoreMax(e.target.value)}
                  placeholder="最高"
                  min={0}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">报名时间 (从)</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">报名时间 (至)</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        {/* 数据表格 */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          {/* 表头 */}
          <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] text-slate-500 uppercase tracking-wider px-4 py-3 bg-slate-800/80 border-b border-slate-700">
            <div className="col-span-2 cursor-pointer hover:text-white" onClick={() => toggleSort('name')}>
              学员 {sortIcon('name')}
            </div>
            <div className="col-span-3">课程</div>
            <div className="col-span-1">状态</div>
            <div className="col-span-1 cursor-pointer hover:text-white" onClick={() => toggleSort('progress')}>
              进度 {sortIcon('progress')}
            </div>
            <div className="col-span-1 cursor-pointer hover:text-white" onClick={() => toggleSort('paidTokens')}>
              付费 {sortIcon('paidTokens')}
            </div>
            <div className="col-span-2 cursor-pointer hover:text-white" onClick={() => toggleSort('score')}>
              考试成绩 {sortIcon('score')}
            </div>
            <div className="col-span-2 cursor-pointer hover:text-white" onClick={() => toggleSort('enrolledAt')}>
              报名时间 {sortIcon('enrolledAt')}
            </div>
          </div>

          {/* 数据行 */}
          {paged.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-4xl">🔍</span>
              <p className="mt-3 text-sm text-slate-500">{hasFilters ? '没有符合条件的学员' : '暂无学员数据'}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {paged.map((s, idx) => {
                const st = statusLabel(s.status)
                return (
                  <div key={`${s.userId}-${s.courseId}-${idx}`} className="px-4 py-3 hover:bg-slate-700/30 transition-colors">
                    {/* Desktop */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                      {/* 学员 */}
                      <div className="col-span-2 flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${
                          s.isAgent ? 'bg-gradient-to-br from-orange-500 to-amber-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'
                        }`}>
                          {s.isAgent ? '🤖' : (s.name?.[0] || '?')}
                        </span>
                        <div className="min-w-0">
                          <span className="text-white text-xs truncate block">{s.name || '匿名'}</span>
                          {s.isAgent && s.humanName && (
                            <span className="text-[10px] text-slate-500 truncate block">{s.humanName}</span>
                          )}
                        </div>
                      </div>
                      {/* 课程 */}
                      <div className="col-span-3 flex items-center gap-1.5 min-w-0">
                        <span className="text-sm flex-shrink-0">{s.courseIcon || '📘'}</span>
                        <span className="text-xs text-slate-300 truncate">{s.courseName}</span>
                      </div>
                      {/* 状态 */}
                      <div className="col-span-1">
                        <span className={`text-xs ${st.color}`}>{st.text}</span>
                      </div>
                      {/* 进度 */}
                      <div className="col-span-1">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                s.progress >= 100 ? 'bg-emerald-500' : s.progress > 0 ? 'bg-orange-500' : 'bg-slate-600'
                              }`}
                              style={{ width: `${s.progress}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 w-7 text-right">{s.progress}%</span>
                        </div>
                      </div>
                      {/* 付费 */}
                      <div className="col-span-1 text-xs">
                        {s.paidTokens > 0
                          ? <span className="text-orange-400">{s.paidTokens}T</span>
                          : <span className="text-slate-600">免费</span>
                        }
                      </div>
                      {/* 考试 */}
                      <div className="col-span-2">
                        {s.exam ? (
                          <div className="flex items-center gap-1.5">
                            {s.exam.gradingStatus === 'pending' || s.exam.gradingStatus === 'manual_grading' ? (
                              <span className="text-[10px] text-amber-400">⏳ 待批改</span>
                            ) : (
                              <span className={`text-xs font-medium ${s.exam.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s.exam.passed ? '✓' : '✗'} {s.exam.totalScore ?? '—'}/{s.exam.maxScore}
                              </span>
                            )}
                            <Link
                              href={`/academy/grade/${s.exam.submissionId}`}
                              className="text-[10px] text-slate-500 hover:text-orange-400"
                            >
                              查看
                            </Link>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600">未提交</span>
                        )}
                      </div>
                      {/* 时间 */}
                      <div className="col-span-2 text-[10px] text-slate-500">
                        {new Date(s.enrolledAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    {/* Mobile */}
                    <div className="sm:hidden">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                            s.isAgent ? 'bg-gradient-to-br from-orange-500 to-amber-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'
                          }`}>
                            {s.isAgent ? '🤖' : (s.name?.[0] || '?')}
                          </span>
                          <div>
                            <p className="text-sm text-white font-medium">{s.name || '匿名'}</p>
                            <p className="text-xs text-slate-400">
                              {s.courseIcon || '📘'} {s.courseName}
                            </p>
                          </div>
                        </div>
                        <span className={`text-xs ${st.color}`}>{st.text}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                        <span>进度 {s.progress}%</span>
                        {s.paidTokens > 0 && <span className="text-orange-400">{s.paidTokens}T</span>}
                        {s.exam && s.exam.totalScore !== null && (
                          <span className={s.exam.passed ? 'text-emerald-400' : 'text-red-400'}>
                            {s.exam.totalScore}/{s.exam.maxScore}
                          </span>
                        )}
                        <span>{new Date(s.enrolledAt).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
              <span className="text-xs text-slate-500">
                第 {page}/{totalPages} 页，共 {filtered.length} 条
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← 上一页
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  下一页 →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

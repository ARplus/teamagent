'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// ============ Types ============
interface Stats {
  users: { total: number }
  agents: { total: number; online: number }
  workspaces: { total: number }
  tasks: { total: number; today: number; done: number; doneRate: number }
  steps: { total: number; done: number; pendingApproval: number }
  attachments: { total: number }
  activity: { date: string; count: number }[]
}

interface UserData {
  id: string
  name: string | null
  email: string
  createdAt: string
  agent: {
    id: string
    name: string
    status: string
    isMainAgent: boolean
    capabilities: string | null
    claimedAt: string | null
    reputation: number | null
  } | null
  workspaces: { role: string; workspace: { id: string; name: string } }[]
  _count: { createdTasks: number; taskSteps: number }
}

interface TaskData {
  id: string
  title: string
  status: string
  priority: string
  mode: string
  createdAt: string
  agentWorkRatio: number | null
  creator: { id: string; name: string | null; email: string }
  workspace: { id: string; name: string }
  stepStats: { total: number; done: number; pending: number; inProgress: number; waitingApproval: number }
}

// ============ Utils ============
const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  review: 'bg-yellow-100 text-yellow-700',
  suggested: 'bg-purple-100 text-purple-700',
}
const AGENT_STATUS_DOT: Record<string, string> = {
  online: 'bg-green-400',
  working: 'bg-blue-400 animate-pulse',
  waiting: 'bg-yellow-400',
  offline: 'bg-gray-300',
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

// ============ StatCard ============
function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string; icon: string; color: string
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`text-2xl w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// ============ Main ============
export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<UserData[]>([])
  const [tasks, setTasks] = useState<TaskData[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'tasks'>('overview')
  const [loading, setLoading] = useState(true)
  const [taskStatus, setTaskStatus] = useState('')

  const ADMIN_EMAILS = ['aurora@arplus.top']

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return }
    if (status === 'authenticated') {
      if (!ADMIN_EMAILS.includes(session.user?.email || '')) {
        router.push('/tasks')
        return
      }
      loadAll()
    }
  }, [status])

  async function loadAll() {
    setLoading(true)
    try {
      const [sRes, uRes, tRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users'),
        fetch('/api/admin/tasks?limit=30'),
      ])
      if (sRes.ok) setStats(await sRes.json())
      if (uRes.ok) { const d = await uRes.json(); setUsers(d.users || []) }
      if (tRes.ok) { const d = await tRes.json(); setTasks(d.tasks || []) }
    } finally {
      setLoading(false)
    }
  }

  async function loadTasks(s?: string) {
    const url = `/api/admin/tasks?limit=30${s ? `&status=${s}` : ''}`
    const res = await fetch(url)
    if (res.ok) { const d = await res.json(); setTasks(d.tasks || []) }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-spin">⚙️</div>
          <p className="text-gray-500">加载管理后台...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/tasks')} className="text-gray-400 hover:text-gray-600 text-sm">← 返回</button>
            <div className="w-px h-4 bg-gray-200" />
            <span className="text-lg font-bold text-gray-900">⚙️ 系统管理</span>
            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          </div>
          <button
            onClick={loadAll}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
          >
            🔄 刷新
          </button>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-6 border-t border-gray-100">
          {[
            { key: 'overview', label: '📊 总览' },
            { key: 'users', label: '👥 用户 & Agent' },
            { key: 'tasks', label: '📋 任务总览' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* ===== OVERVIEW ===== */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard label="注册用户" value={stats.users.total} icon="👤" color="bg-indigo-50" />
              <StatCard label="Agent 总数" value={stats.agents.total} sub={`${stats.agents.online} 在线`} icon="🤖" color="bg-blue-50" />
              <StatCard label="工作区" value={stats.workspaces.total} icon="🏢" color="bg-purple-50" />
              <StatCard label="任务总数" value={stats.tasks.total} sub={`今日 +${stats.tasks.today}`} icon="📋" color="bg-orange-50" />
              <StatCard label="完成率" value={`${stats.tasks.doneRate}%`} sub={`${stats.tasks.done} 已完成`} icon="✅" color="bg-green-50" />
              <StatCard label="待审批" value={stats.steps.pendingApproval} icon="⏳" color="bg-yellow-50" />
            </div>

            {/* Agent Status + Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Agent 状态 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-4">🤖 Agent 状态分布</h3>
                <div className="space-y-3">
                  {users.filter(u => u.agent).map(u => (
                    <div key={u.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${AGENT_STATUS_DOT[u.agent!.status] || 'bg-gray-300'}`} />
                        <span className="text-sm font-medium text-gray-800">{u.agent!.name}</span>
                        {u.agent!.isMainAgent && <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">主</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{u.name || u.email}</span>
                        <span className={`px-2 py-0.5 rounded-full ${
                          u.agent!.status === 'online' ? 'bg-green-100 text-green-700' :
                          u.agent!.status === 'working' ? 'bg-blue-100 text-blue-700' :
                          u.agent!.status === 'waiting' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{u.agent!.status}</span>
                      </div>
                    </div>
                  ))}
                  {users.filter(u => u.agent).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">暂无 Agent</p>
                  )}
                </div>
              </div>

              {/* 近期活动 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-4">📈 近7天任务趋势</h3>
                {stats.activity.length > 0 ? (
                  <div className="flex items-end gap-2 h-32">
                    {stats.activity.map((a, i) => {
                      const maxCount = Math.max(...stats.activity.map(x => x.count), 1)
                      const height = Math.max((a.count / maxCount) * 100, 8)
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-500">{a.count}</span>
                          <div
                            className="w-full rounded-t-md bg-indigo-400 transition-all"
                            style={{ height: `${height}%` }}
                          />
                          <span className="text-xs text-gray-400">
                            {new Date(a.date).getMonth() + 1}/{new Date(a.date).getDate()}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">暂无数据</p>
                )}

                {/* Step 统计 */}
                <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xl font-bold text-gray-800">{stats.steps.total}</p>
                    <p className="text-xs text-gray-400">总步骤</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-green-600">{stats.steps.done}</p>
                    <p className="text-xs text-gray-400">已完成</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-yellow-600">{stats.steps.pendingApproval}</p>
                    <p className="text-xs text-gray-400">待审批</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== USERS ===== */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">👥 用户列表 ({users.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">用户</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">Agent</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">工作区</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">任务/步骤</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">注册时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">{u.name || '(未命名)'}</div>
                        <div className="text-xs text-gray-400">{u.email}</div>
                      </td>
                      <td className="px-5 py-4">
                        {u.agent ? (
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${AGENT_STATUS_DOT[u.agent.status] || 'bg-gray-300'}`} />
                            <div>
                              <div className="font-medium text-gray-800 flex items-center gap-1">
                                {u.agent.name}
                                {u.agent.isMainAgent && <span className="text-xs bg-indigo-100 text-indigo-600 px-1 rounded">主</span>}
                              </div>
                              <div className="text-xs text-gray-400">{u.agent.status}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">未配对</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-1">
                          {u.workspaces.map(w => (
                            <div key={w.workspace.id} className="flex items-center gap-1">
                              <span className="text-xs text-gray-600">{w.workspace.name}</span>
                              <span className="text-xs text-gray-300">({w.role})</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-gray-700">{u._count.createdTasks}</span>
                        <span className="text-gray-300"> / </span>
                        <span className="text-gray-700">{u._count.taskSteps}</span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-400">
                        {timeAgo(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== TASKS ===== */}
        {activeTab === 'tasks' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
              <h3 className="font-semibold text-gray-800">📋 全平台任务</h3>
              <div className="flex gap-2 ml-auto">
                {['', 'todo', 'in_progress', 'done'].map(s => (
                  <button
                    key={s}
                    onClick={() => { setTaskStatus(s); loadTasks(s || undefined) }}
                    className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                      taskStatus === s
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {s === '' ? '全部' : s === 'todo' ? '待开始' : s === 'in_progress' ? '进行中' : '已完成'}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">任务</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">工作区</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">状态</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">步骤</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">Agent贡献</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">创建者</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-400 uppercase">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tasks.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4 max-w-xs">
                        <div className="font-medium text-gray-900 truncate">{t.title}</div>
                        <div className="flex gap-1 mt-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${t.mode === 'solo' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                            {t.mode === 'solo' ? '🤖 Solo' : '👥 Team'}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            t.priority === 'urgent' ? 'bg-red-100 text-red-600' :
                            t.priority === 'high' ? 'bg-orange-100 text-orange-600' :
                            'bg-gray-100 text-gray-500'
                          }`}>{t.priority}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">{t.workspace.name}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-600'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-green-600">{t.stepStats.done}</span>
                          <span className="text-gray-300">/</span>
                          <span className="text-gray-600">{t.stepStats.total}</span>
                          {t.stepStats.waitingApproval > 0 && (
                            <span className="text-yellow-500 ml-1">⏳{t.stepStats.waitingApproval}</span>
                          )}
                        </div>
                        {t.stepStats.total > 0 && (
                          <div className="mt-1 w-16 h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-400 rounded-full"
                              style={{ width: `${(t.stepStats.done / t.stepStats.total) * 100}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {t.agentWorkRatio != null ? (
                          <span className="text-xs text-indigo-600 font-medium">
                            {Math.round(t.agentWorkRatio * 100)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">{t.creator.name || t.creator.email}</td>
                      <td className="px-5 py-4 text-xs text-gray-400">{timeAgo(t.createdAt)}</td>
                    </tr>
                  ))}
                  {tasks.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-gray-400 text-sm">暂无任务</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

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
  phone: string | null
  creditBalance: number
  createdAt: string
  agent: {
    id: string
    name: string
    status: string
    isMainAgent: boolean
    capabilities: string | null
    claimedAt: string | null
    reputation: number | null
    childAgents: { id: string; name: string; status: string; avatar: string | null }[]
  } | null
  workspaces: { role: string; workspace: { id: string; name: string } }[]
  _count: { createdTasks: number; taskSteps: number; apiTokens: number }
  courseStats?: {
    totalSpent: number
    enrolledCount: number
    publishedCount: number
    totalEarned: number
    totalStudents: number
  }
  spendingHistory?: { courseName: string; courseIcon: string | null; paidTokens: number; status: string; enrolledAt: string }[]
  earningCourses?: { courseName: string; courseIcon: string | null; price: number | null; studentCount: number; totalRevenue: number }[]
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

// F05: 三级层级
interface HierarchyMember {
  role: 'member'
  id: string; name: string; status: string; avatar: string | null
  capabilities: string[]; reputation: number | null
  linkedUser: { id: string; name: string | null } | null
}
interface HierarchyCommander {
  role: 'commander'
  id: string; name: string; status: string; avatar: string | null
  capabilities: string[]; reputation: number | null; claimedAt: string | null
  members: HierarchyMember[]
}
interface HierarchyNode {
  role: 'human'
  id: string; name: string; email: string; avatar: string | null; createdAt: string
  workspaces: { role: string; name: string; id: string }[]
  stats: { tasks: number; steps: number }
  commander: HierarchyCommander | null
}
interface WorkspaceOverview {
  id: string; name: string; memberCount: number
  taskStats: { total: number; done: number; inProgress: number; todo: number }
}
interface HierarchySummary {
  totalHumans: number; totalCommanders: number; totalMembers: number; unpairedHumans: number
}

// ============ Utils ============
const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-slate-800 text-slate-300',
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
    <div className="bg-slate-800 rounded-2xl p-5 shadow-lg shadow-black/20 border border-slate-700/50">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
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
  const [showVirtualUsers, setShowVirtualUsers] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'tasks' | 'hierarchy' | 'activation' | 'courses' | 'orgs'>('overview')
  const [loading, setLoading] = useState(true)
  const [taskStatus, setTaskStatus] = useState('')
  const [hierarchy, setHierarchy] = useState<HierarchyNode[]>([])
  const [wsOverview, setWsOverview] = useState<WorkspaceOverview[]>([])
  const [hSummary, setHSummary] = useState<HierarchySummary | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  // 激活码管理
  const [actCodes, setActCodes] = useState<any[]>([])
  const [actStats, setActStats] = useState<any>(null)
  const [actGenCount, setActGenCount] = useState(5)
  const [actGenCredits, setActGenCredits] = useState(1000)
  const [actGenDays, setActGenDays] = useState(90)
  const [actGenNote, setActGenNote] = useState('')
  const [actGenLoading, setActGenLoading] = useState(false)
  const [actNewCodes, setActNewCodes] = useState<string[]>([])
  const [actCopied, setActCopied] = useState(false)

  // 充值相关
  const [spendingUser, setSpendingUser] = useState<UserData | null>(null)
  const [rechargeUser, setRechargeUser] = useState<UserData | null>(null)
  const [rechargeCredits, setRechargeCredits] = useState(1000)
  const [rechargeNote, setRechargeNote] = useState('')
  const [rechargeLoading, setRechargeLoading] = useState(false)
  const [rechargeResult, setRechargeResult] = useState<{ message: string; newToken?: string } | null>(null)

  const ADMIN_EMAILS = ['aurora@arplus.top', 'muxu@arplus.top', 'yiq.duan@gmail.com']

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return }
    if (status === 'authenticated') {
      if (!ADMIN_EMAILS.includes(session.user?.email || '')) {
        router.push('/workspace')
        return
      }
      loadAll()
    }
  }, [status])

  // 切换虚拟账号显示时重新拉用户列表
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch(`/api/admin/users${showVirtualUsers ? '?showVirtual=1' : ''}`)
      .then(r => r.json())
      .then(d => setUsers(d.users || []))
      .catch(() => {})
  }, [showVirtualUsers, status])

  async function loadAll() {
    setLoading(true)
    try {
      const [sRes, uRes, tRes, hRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch(`/api/admin/users${showVirtualUsers ? '?showVirtual=1' : ''}`),
        fetch('/api/admin/tasks?limit=30'),
        fetch('/api/admin/hierarchy'),
      ])
      if (sRes.ok) setStats(await sRes.json())
      if (uRes.ok) { const d = await uRes.json(); setUsers(d.users || []) }
      if (tRes.ok) { const d = await tRes.json(); setTasks(d.tasks || []) }
      if (hRes.ok) {
        const d = await hRes.json()
        setHierarchy(d.hierarchy || [])
        setWsOverview(d.workspaceOverview || [])
        setHSummary(d.summary || null)
        // 默认展开所有节点
        const ids = new Set<string>()
        ;(d.hierarchy || []).forEach((h: HierarchyNode) => {
          ids.add(h.id)
          if (h.commander) ids.add(h.commander.id)
        })
        setExpandedNodes(ids)
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadTasks(s?: string) {
    const url = `/api/admin/tasks?limit=30${s ? `&status=${s}` : ''}`
    const res = await fetch(url)
    if (res.ok) { const d = await res.json(); setTasks(d.tasks || []) }
  }

  async function handleRecharge() {
    if (!rechargeUser) return
    setRechargeLoading(true)
    setRechargeResult(null)
    try {
      const res = await fetch('/api/admin/users/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: rechargeUser.id,
          credits: rechargeCredits,
          note: rechargeNote || `管理员手动充值 ${rechargeCredits} Token`,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setRechargeResult({
          message: data.message,
          newToken: data.newToken,
        })
        // 刷新用户列表
        const uRes = await fetch('/api/admin/users')
        if (uRes.ok) { const d = await uRes.json(); setUsers(d.users || []) }
      } else {
        setRechargeResult({ message: `❌ ${data.error}` })
      }
    } catch {
      setRechargeResult({ message: '❌ 网络错误' })
    } finally {
      setRechargeLoading(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-spin">⚙️</div>
          <p className="text-slate-400">加载管理后台...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/workspace')} className="text-slate-500 hover:text-slate-300 text-sm">← 返回</button>
            <div className="w-px h-4 bg-slate-700" />
            <span className="text-lg font-bold text-white">⚙️ 系统管理</span>
            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Admin</span>
          </div>
          <button
            onClick={loadAll}
            className="text-sm text-slate-400 hover:text-slate-100 flex items-center gap-1"
          >
            🔄 刷新
          </button>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-6 border-t border-slate-700/50">
          {[
            { key: 'overview', label: '📊 总览' },
            { key: 'hierarchy', label: '🌳 团队层级' },
            { key: 'users', label: '👥 用户 & Agent' },
            { key: 'tasks', label: '📋 任务总览' },
            { key: 'activation', label: '🎫 激活码' },
            { key: 'courses', label: '🦞 课程审核' },
            { key: 'orgs', label: '🏛️ 组织管理' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
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
              <div className="bg-slate-800 rounded-2xl p-5 shadow-lg shadow-black/20 border border-slate-700/50">
                <h3 className="font-semibold text-slate-100 mb-4">🤖 Agent 状态分布</h3>
                <div className="space-y-3">
                  {users.filter(u => u.agent).map(u => (
                    <div key={u.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${AGENT_STATUS_DOT[u.agent!.status] || 'bg-gray-300'}`} />
                        <span className="text-sm font-medium text-slate-100">{u.agent!.name}</span>
                        {u.agent!.isMainAgent && <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">主</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{u.name || u.email}</span>
                        <span className={`px-2 py-0.5 rounded-full ${
                          u.agent!.status === 'online' ? 'bg-green-100 text-green-700' :
                          u.agent!.status === 'working' ? 'bg-blue-100 text-blue-700' :
                          u.agent!.status === 'waiting' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-slate-800 text-slate-400'
                        }`}>{u.agent!.status}</span>
                      </div>
                    </div>
                  ))}
                  {users.filter(u => u.agent).length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-4">暂无 Agent</p>
                  )}
                </div>
              </div>

              {/* 近期活动 */}
              <div className="bg-slate-800 rounded-2xl p-5 shadow-lg shadow-black/20 border border-slate-700/50">
                <h3 className="font-semibold text-slate-100 mb-4">📈 近7天任务趋势</h3>
                {stats.activity.length > 0 ? (
                  <div className="flex items-end gap-2 h-32">
                    {stats.activity.map((a, i) => {
                      const maxCount = Math.max(...stats.activity.map(x => x.count), 1)
                      const height = Math.max((a.count / maxCount) * 100, 8)
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs text-slate-400">{a.count}</span>
                          <div
                            className="w-full rounded-t-md bg-indigo-400 transition-all"
                            style={{ height: `${height}%` }}
                          />
                          <span className="text-xs text-slate-500">
                            {new Date(a.date).getMonth() + 1}/{new Date(a.date).getDate()}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 text-center py-8">暂无数据</p>
                )}

                {/* Step 统计 */}
                <div className="mt-4 pt-4 border-t border-slate-700/50 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xl font-bold text-slate-100">{stats.steps.total}</p>
                    <p className="text-xs text-slate-500">总步骤</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-green-600">{stats.steps.done}</p>
                    <p className="text-xs text-slate-500">已完成</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-yellow-600">{stats.steps.pendingApproval}</p>
                    <p className="text-xs text-slate-500">待审批</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== HIERARCHY (F05) ===== */}
        {activeTab === 'hierarchy' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            {hSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard label="人类用户" value={hSummary.totalHumans} icon="👤" color="bg-indigo-50" />
                <StatCard label="主 Agent" value={hSummary.totalCommanders} icon="🤖" color="bg-blue-50" sub={`${hSummary.unpairedHumans} 人未配对`} />
                <StatCard label="子 Agent" value={hSummary.totalMembers} icon="⚙️" color="bg-purple-50" />
                <StatCard label="总成员" value={hSummary.totalHumans + hSummary.totalCommanders + hSummary.totalMembers} icon="🌳" color="bg-orange-50" />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Tree View */}
              <div className="lg:col-span-2 bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
                <div className="p-5 border-b border-slate-700/50 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-100">🌳 三级层级视图</h3>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span>👤 Human</span>
                    <span>🤖 Commander</span>
                    <span>⚙️ Member</span>
                  </div>
                </div>
                <div className="p-4 space-y-1">
                  {hierarchy.map(node => {
                    const isExpanded = expandedNodes.has(node.id)
                    const hasChildren = !!node.commander
                    const totalSubs = node.commander?.members.length || 0
                    return (
                      <div key={node.id} className="select-none">
                        {/* Level 1: Human */}
                        <div
                          className="flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-slate-900 cursor-pointer transition-colors group"
                          onClick={() => {
                            const next = new Set(expandedNodes)
                            if (isExpanded) { next.delete(node.id) } else { next.add(node.id) }
                            setExpandedNodes(next)
                          }}
                        >
                          <span className="w-4 text-slate-500 text-xs">{hasChildren ? (isExpanded ? '▼' : '▶') : '●'}</span>
                          <span className="text-lg">👤</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">{node.name}</span>
                              <span className="text-xs bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded font-medium">Human</span>
                              {node.workspaces.map(w => (
                                <span key={w.id} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{w.name} ({w.role})</span>
                              ))}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{node.email} · 任务 {node.stats.tasks} · 步骤 {node.stats.steps}</div>
                          </div>
                          {!node.commander && (
                            <span className="text-xs text-orange-400 bg-orange-50 px-2 py-0.5 rounded-full">未配对 Agent</span>
                          )}
                        </div>

                        {/* Level 2: Commander (Main Agent) */}
                        {isExpanded && node.commander && (
                          <div className="ml-6">
                            <div
                              className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50/50 cursor-pointer transition-colors"
                              onClick={() => {
                                const next = new Set(expandedNodes)
                                const cid = node.commander!.id
                                if (next.has(cid)) { next.delete(cid) } else { next.add(cid) }
                                setExpandedNodes(next)
                              }}
                            >
                              <span className="w-4 text-slate-500 text-xs">{totalSubs > 0 ? (expandedNodes.has(node.commander.id) ? '▼' : '▶') : '●'}</span>
                              <span className="text-lg">🤖</span>
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${AGENT_STATUS_DOT[node.commander.status] || 'bg-gray-300'}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-100">{node.commander.name}</span>
                                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">Commander</span>
                                  {node.commander.reputation != null && node.commander.reputation > 0 && (
                                    <span className="text-xs text-yellow-600">⭐ {node.commander.reputation.toFixed(1)}</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {node.commander.capabilities.length > 0
                                    ? node.commander.capabilities.join(' · ')
                                    : '无特殊能力标签'}
                                  {totalSubs > 0 && ` · ${totalSubs} 个子 Agent`}
                                </div>
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                node.commander.status === 'online' ? 'bg-green-100 text-green-700' :
                                node.commander.status === 'working' ? 'bg-blue-100 text-blue-700' :
                                node.commander.status === 'waiting' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-slate-800 text-slate-400'
                              }`}>{node.commander.status}</span>
                            </div>

                            {/* Level 3: Members (Sub Agents) */}
                            {expandedNodes.has(node.commander.id) && node.commander.members.map(member => (
                              <div key={member.id} className="ml-6 flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-purple-50/50 transition-colors">
                                <span className="w-4 text-gray-300 text-xs">└</span>
                                <span className="text-lg">⚙️</span>
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${AGENT_STATUS_DOT[member.status] || 'bg-gray-300'}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-200">{member.name}</span>
                                    <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded font-medium">Member</span>
                                    {member.reputation != null && member.reputation > 0 && (
                                      <span className="text-xs text-yellow-600">⭐ {member.reputation.toFixed(1)}</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    {member.capabilities.length > 0
                                      ? member.capabilities.join(' · ')
                                      : '无能力标签'}
                                    {member.linkedUser && ` · 关联: ${member.linkedUser.name || member.linkedUser.id}`}
                                  </div>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  member.status === 'online' ? 'bg-green-100 text-green-700' :
                                  member.status === 'working' ? 'bg-blue-100 text-blue-700' :
                                  member.status === 'waiting' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-slate-800 text-slate-400'
                                }`}>{member.status}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {hierarchy.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-8">暂无数据</p>
                  )}
                </div>
              </div>

              {/* Workspace Overview Sidebar */}
              <div className="space-y-4">
                <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
                  <div className="p-5 border-b border-slate-700/50">
                    <h3 className="font-semibold text-slate-100">🏢 工作区任务概览</h3>
                  </div>
                  <div className="p-4 space-y-3">
                    {wsOverview.map(ws => {
                      const { total, done, inProgress, todo } = ws.taskStats
                      const doneRate = total > 0 ? Math.round((done / total) * 100) : 0
                      return (
                        <div key={ws.id} className="p-3 rounded-xl bg-slate-900 border border-slate-700/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-slate-100">{ws.name}</span>
                            <span className="text-xs text-slate-500">{ws.memberCount} 成员</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div>
                              <p className="text-sm font-bold text-slate-200">{total}</p>
                              <p className="text-xs text-slate-500">总计</p>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-blue-600">{inProgress}</p>
                              <p className="text-xs text-slate-500">进行中</p>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-green-600">{done}</p>
                              <p className="text-xs text-slate-500">完成</p>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-400">{todo}</p>
                              <p className="text-xs text-slate-500">待办</p>
                            </div>
                          </div>
                          {total > 0 && (
                            <div className="mt-2">
                              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${doneRate}%` }} />
                              </div>
                              <p className="text-xs text-slate-500 mt-1 text-right">{doneRate}% 完成</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {wsOverview.length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-4">暂无工作区</p>
                    )}
                  </div>
                </div>

                {/* 归属链快速查看 */}
                <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
                  <div className="p-5 border-b border-slate-700/50">
                    <h3 className="font-semibold text-slate-100">🔗 归属链速览</h3>
                  </div>
                  <div className="p-4 space-y-2">
                    {hierarchy.flatMap(node =>
                      node.commander
                        ? [
                            // Commander line
                            <div key={`chain-${node.commander.id}`} className="flex items-center gap-1 text-xs text-slate-300 py-1">
                              <span>🤖 {node.commander.name}</span>
                              <span className="text-gray-300">→</span>
                              <span>👤 {node.name}</span>
                              <div className={`w-1.5 h-1.5 rounded-full ml-1 ${AGENT_STATUS_DOT[node.commander.status] || 'bg-gray-300'}`} />
                            </div>,
                            // Each sub-agent line
                            ...node.commander.members.map(m => (
                              <div key={`chain-${m.id}`} className="flex items-center gap-1 text-xs text-slate-400 py-1 pl-4">
                                <span>⚙️ {m.name}</span>
                                <span className="text-gray-300">→</span>
                                <span>🤖 {node.commander!.name}</span>
                                <span className="text-gray-300">→</span>
                                <span>👤 {node.name}</span>
                                <div className={`w-1.5 h-1.5 rounded-full ml-1 ${AGENT_STATUS_DOT[m.status] || 'bg-gray-300'}`} />
                              </div>
                            )),
                          ]
                        : []
                    )}
                    {hierarchy.filter(n => n.commander).length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-4">暂无归属链</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== USERS ===== */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
              <div className="p-5 border-b border-slate-700/50 flex items-center justify-between">
                <h3 className="font-semibold text-slate-100">👥 用户列表 ({users.length})</h3>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={showVirtualUsers}
                      onChange={e => setShowVirtualUsers(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-indigo-500"
                    />
                    显示子Agent虚拟账号
                  </label>
                  <span className="text-xs text-slate-500">点击「已付款」直接充值Token</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-left">
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">用户</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">主Agent</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">子Agent</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">💰 额度</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">📚 课程</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">📊 任务</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">注册</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-slate-900 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-white text-sm">{u.name || '(未命名)'}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                          {u.phone && <div className="text-xs text-orange-500">📱 {u.phone}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {u.agent ? (
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${AGENT_STATUS_DOT[u.agent.status] || 'bg-gray-300'}`} />
                              <div className="text-sm font-medium text-slate-100">{u.agent.name}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">未配对</span>
                          )}
                        </td>
                        {/* 子Agent列 */}
                        <td className="px-4 py-3">
                          {u.agent && u.agent.childAgents.length > 0 ? (
                            <div className="relative group">
                              <span className="inline-flex items-center gap-1 text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full cursor-default">
                                ⚙️ {u.agent.childAgents.length}
                              </span>
                              {/* 悬停下拉 */}
                              <div className="absolute left-0 top-6 z-20 hidden group-hover:block bg-slate-700 border border-slate-600 rounded-xl shadow-xl p-2 min-w-[140px]">
                                {u.agent.childAgents.map(c => (
                                  <div key={c.id} className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-200">
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${AGENT_STATUS_DOT[c.status] || 'bg-gray-400'}`} />
                                    {c.name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className={`font-bold text-sm ${u.creditBalance > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                              {u.creditBalance}
                            </span>
                            {u._count.apiTokens > 0 && (
                              <span className="ml-1 text-[10px] bg-green-100 text-green-600 px-1 py-0.5 rounded">🔑</span>
                            )}
                          </div>
                          {/* 消费/收益汇总 */}
                          {u.courseStats && (u.courseStats.totalSpent > 0 || u.courseStats.totalEarned > 0) && (
                            <div className="text-[10px] mt-0.5 space-y-0.5">
                              {u.courseStats.totalSpent > 0 && (
                                <div className="text-red-400">消费 {u.courseStats.totalSpent}T</div>
                              )}
                              {u.courseStats.totalEarned > 0 && (
                                <div className="text-emerald-500">收益 {u.courseStats.totalEarned}T</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {u.courseStats ? (
                            <div className="text-xs space-y-0.5">
                              {u.courseStats.enrolledCount > 0 && (
                                <div className="text-blue-600">🎒 购 {u.courseStats.enrolledCount}</div>
                              )}
                              {u.courseStats.publishedCount > 0 && (
                                <div className="text-purple-600">📖 发 {u.courseStats.publishedCount}</div>
                              )}
                              {u.courseStats.enrolledCount === 0 && u.courseStats.publishedCount === 0 && (
                                <span className="text-gray-300">—</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="text-slate-200">{u._count.createdTasks}</span>
                          <span className="text-gray-300"> / </span>
                          <span className="text-slate-200">{u._count.taskSteps}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {timeAgo(u.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => {
                                setRechargeUser(u)
                                setRechargeCredits(1000)
                                setRechargeNote('')
                                setRechargeResult(null)
                              }}
                              className="text-[10px] bg-orange-500 text-white px-2 py-1 rounded hover:bg-orange-600 transition-colors font-medium"
                            >
                              💰 充值
                            </button>
                            {u.courseStats && (u.courseStats.enrolledCount > 0 || u.courseStats.publishedCount > 0 || u.courseStats.totalSpent > 0 || u.courseStats.totalEarned > 0) && (
                              <button
                                onClick={() => setSpendingUser(u)}
                                className="text-[10px] bg-slate-800 text-slate-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors"
                              >
                                📋 记录
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 充值弹窗 */}
            {rechargeUser && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !rechargeLoading && setRechargeUser(null)}>
                <div className="bg-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-white mb-1">💰 确认充值</h3>
                  <p className="text-sm text-slate-400 mb-4">
                    给 <span className="font-medium text-slate-100">{rechargeUser.name || rechargeUser.email}</span> 充值Token
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 font-medium">用户</label>
                      <div className="text-sm text-slate-100 bg-slate-900 rounded-lg px-3 py-2 mt-1">
                        {rechargeUser.name || '(未命名)'} · {rechargeUser.email}
                        {rechargeUser.phone && <span className="text-orange-500 ml-1">📱{rechargeUser.phone}</span>}
                        <div className="text-xs text-slate-500 mt-0.5">
                          当前余额: {rechargeUser.creditBalance} Token
                          {rechargeUser._count.apiTokens === 0 && ' · ⚠️ 无Token（充值后自动生成）'}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-medium">充值Token</label>
                      <div className="flex gap-2 mt-1">
                        {[500, 1000, 2000, 5000].map(c => (
                          <button
                            key={c}
                            onClick={() => setRechargeCredits(c)}
                            className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${
                              rechargeCredits === c
                                ? 'border-orange-500 bg-orange-50 text-orange-700 font-medium'
                                : 'border-slate-700 text-slate-300 hover:border-slate-600'
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        value={rechargeCredits}
                        onChange={e => setRechargeCredits(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full mt-2 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                        placeholder="自定义Token数"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-medium">备注（可选）</label>
                      <input
                        type="text"
                        value={rechargeNote}
                        onChange={e => setRechargeNote(e.target.value)}
                        className="w-full mt-1 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                        placeholder="如：微信付款 ¥49"
                      />
                    </div>
                  </div>

                  {rechargeResult && (
                    <div className={`mt-4 p-3 rounded-lg text-sm ${
                      rechargeResult.message.startsWith('❌') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                    }`}>
                      <p>{rechargeResult.message}</p>
                      {rechargeResult.newToken && (
                        <div className="mt-2 p-2 bg-slate-800 rounded border border-green-200">
                          <p className="text-xs text-slate-400 mb-1">🔑 自动生成的 API Token（仅显示一次）：</p>
                          <code className="text-xs break-all text-slate-100 select-all">{rechargeResult.newToken}</code>
                          <button
                            onClick={() => { navigator.clipboard.writeText(rechargeResult.newToken!); }}
                            className="ml-2 text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            复制
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 mt-5">
                    <button
                      onClick={() => setRechargeUser(null)}
                      className="flex-1 text-sm py-2.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-900"
                      disabled={rechargeLoading}
                    >
                      {rechargeResult && !rechargeResult.message.startsWith('❌') ? '关闭' : '取消'}
                    </button>
                    {(!rechargeResult || rechargeResult.message.startsWith('❌')) && (
                      <button
                        onClick={handleRecharge}
                        disabled={rechargeLoading || rechargeCredits < 1}
                        className="flex-1 text-sm py-2.5 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {rechargeLoading ? '处理中...' : `确认充值 ${rechargeCredits} Token`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 消费记录弹窗 */}
            {spendingUser && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSpendingUser(null)}>
                <div className="bg-slate-800 rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">📋 消费/收益记录</h3>
                    <button onClick={() => setSpendingUser(null)} className="text-slate-500 hover:text-slate-300">✕</button>
                  </div>
                  <div className="text-sm text-slate-300 mb-4 bg-slate-900 rounded-lg p-3">
                    <span className="font-medium text-slate-100">{spendingUser.name || spendingUser.email}</span>
                    <span className="text-slate-500 ml-2">余额 {spendingUser.creditBalance}T</span>
                    {spendingUser.courseStats && (
                      <div className="flex gap-4 mt-1 text-xs">
                        <span className="text-red-400">累计消费 {spendingUser.courseStats.totalSpent}T</span>
                        <span className="text-emerald-500">累计收益 {spendingUser.courseStats.totalEarned}T</span>
                      </div>
                    )}
                  </div>

                  {/* 消费记录 */}
                  {spendingUser.spendingHistory && spendingUser.spendingHistory.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-slate-200 mb-2">🎒 购买课程</h4>
                      <div className="space-y-1.5">
                        {spendingUser.spendingHistory.map((s, i) => (
                          <div key={i} className="flex items-center justify-between text-xs bg-slate-900 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span>{s.courseIcon || '📚'}</span>
                              <span className="text-slate-200">{s.courseName}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                s.status === 'graduated' ? 'bg-emerald-100 text-emerald-600' :
                                s.status === 'completed' ? 'bg-blue-100 text-blue-600' :
                                'bg-slate-800 text-slate-400'
                              }`}>{s.status}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {s.paidTokens > 0 ? (
                                <span className="text-red-500 font-medium">-{s.paidTokens}T</span>
                              ) : (
                                <span className="text-slate-500">免费</span>
                              )}
                              <span className="text-gray-300 text-[10px]">{new Date(s.enrolledAt).toLocaleDateString('zh-CN')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 收益记录 */}
                  {spendingUser.earningCourses && spendingUser.earningCourses.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-200 mb-2">📖 发布课程收益</h4>
                      <div className="space-y-1.5">
                        {spendingUser.earningCourses.map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-xs bg-slate-900 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span>{c.courseIcon || '📚'}</span>
                              <span className="text-slate-200">{c.courseName}</span>
                              <span className="text-slate-500">定价 {c.price || 0}T</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-purple-500">{c.studentCount} 学生</span>
                              {c.totalRevenue > 0 && (
                                <span className="text-emerald-600 font-medium">+{c.totalRevenue}T</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(!spendingUser.spendingHistory?.length && !spendingUser.earningCourses?.length) && (
                    <p className="text-center text-slate-500 text-sm py-4">暂无消费或收益记录</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== TASKS ===== */}
        {activeTab === 'tasks' && (
          <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
            <div className="p-5 border-b border-slate-700/50 flex items-center gap-3 flex-wrap">
              <h3 className="font-semibold text-slate-100">📋 全平台任务</h3>
              <div className="flex gap-2 ml-auto">
                {['', 'todo', 'in_progress', 'done'].map(s => (
                  <button
                    key={s}
                    onClick={() => { setTaskStatus(s); loadTasks(s || undefined) }}
                    className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                      taskStatus === s
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
                  <tr className="bg-slate-900 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">任务</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">工作区</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">状态</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">步骤</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">Agent贡献</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">创建者</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tasks.map(t => (
                    <tr key={t.id} className="hover:bg-slate-900 transition-colors">
                      <td className="px-5 py-4 max-w-xs">
                        <div className="font-medium text-white truncate">{t.title}</div>
                        <div className="flex gap-1 mt-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${t.mode === 'solo' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                            {t.mode === 'solo' ? '🤖 Solo' : '👥 Team'}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            t.priority === 'urgent' ? 'bg-red-100 text-red-600' :
                            t.priority === 'high' ? 'bg-orange-100 text-orange-600' :
                            'bg-slate-800 text-slate-400'
                          }`}>{t.priority}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400">{t.workspace.name}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[t.status] || 'bg-slate-800 text-slate-300'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-green-600">{t.stepStats.done}</span>
                          <span className="text-gray-300">/</span>
                          <span className="text-slate-300">{t.stepStats.total}</span>
                          {t.stepStats.waitingApproval > 0 && (
                            <span className="text-yellow-500 ml-1">⏳{t.stepStats.waitingApproval}</span>
                          )}
                        </div>
                        {t.stepStats.total > 0 && (
                          <div className="mt-1 w-16 h-1 bg-slate-700 rounded-full overflow-hidden">
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
                      <td className="px-5 py-4 text-xs text-slate-400">{t.creator.name || t.creator.email}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">{timeAgo(t.createdAt)}</td>
                    </tr>
                  ))}
                  {tasks.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-500 text-sm">暂无任务</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== COURSES REVIEW ===== */}
        {activeTab === 'courses' && <CoursesReviewTab />}

        {/* ===== ORGS MANAGEMENT ===== */}
        {activeTab === 'orgs' && <OrgsManagementTab />}

        {/* ===== ACTIVATION CODES ===== */}
        {activeTab === 'activation' && (
          <ActivationTab
            codes={actCodes} setCodes={setActCodes}
            stats={actStats} setStats={setActStats}
            genCount={actGenCount} setGenCount={setActGenCount}
            genCredits={actGenCredits} setGenCredits={setActGenCredits}
            genDays={actGenDays} setGenDays={setActGenDays}
            genNote={actGenNote} setGenNote={setActGenNote}
            genLoading={actGenLoading} setGenLoading={setActGenLoading}
            newCodes={actNewCodes} setNewCodes={setActNewCodes}
            copied={actCopied} setCopied={setActCopied}
          />
        )}
      </div>
    </div>
  )
}

// ============ 课程审核组件 ============
function CoursesReviewTab() {
  const [courses, setCourses] = useState<any[]>([])
  const [filter, setFilter] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [previewCourse, setPreviewCourse] = useState<any | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const openPreview = async (id: string) => {
    setPreviewLoading(true)
    setPreviewCourse({ id, loading: true })
    try {
      const res = await fetch(`/api/admin/courses/${id}`)
      if (res.ok) setPreviewCourse(await res.json())
      else setPreviewCourse(null)
    } catch { setPreviewCourse(null) }
    finally { setPreviewLoading(false) }
  }

  useEffect(() => { fetchCourses() }, [filter])

  const fetchCourses = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/courses?status=${filter}`)
      if (res.ok) {
        const data = await res.json()
        setCourses(data.courses || [])
      }
    } catch (e) { console.error('获取课程失败', e) }
    finally { setLoading(false) }
  }

  const handleReview = async (id: string, action: 'approve' | 'reject' | 'takedown' | 'restore') => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/courses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: reviewNote }),
      })
      if (res.ok) {
        setReviewingId(null)
        setReviewNote('')
        fetchCourses()
      } else {
        const data = await res.json()
        alert(data.error || '操作失败')
      }
    } catch { alert('操作失败') }
    finally { setActionLoading(false) }
  }

  const courseTypeLabel: Record<string, string> = {
    human: '👤 人类课',
    agent: '🤖 Agent课',
    both: '🤝 共学课',
  }

  const statusLabel: Record<string, { text: string; color: string }> = {
    none: { text: '未提交', color: 'bg-slate-800 text-slate-400' },
    pending: { text: '待审核', color: 'bg-yellow-100 text-yellow-700' },
    approved: { text: '已通过', color: 'bg-green-100 text-green-700' },
    rejected: { text: '已驳回', color: 'bg-red-100 text-red-700' },
  }

  return (
    <div className="space-y-6">
      {/* 课程详情 Modal */}
      {previewCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPreviewCourse(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{previewCourse.icon || '🎓'}</span>
                <div>
                  <h3 className="font-semibold text-slate-100">{previewCourse.name || '加载中...'}</h3>
                  {previewCourse.creator && (
                    <p className="text-xs text-slate-400">创建者：{previewCourse.creator.name || previewCourse.creator.email}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setPreviewCourse(null)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">✕</button>
            </div>
            {previewCourse.loading ? (
              <div className="p-8 text-center text-slate-400">加载中...</div>
            ) : (
              <div className="p-6 space-y-4">
                {previewCourse.description && (
                  <p className="text-sm text-slate-300 bg-slate-700/40 rounded-lg p-3">{previewCourse.description}</p>
                )}
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">课程内容（{previewCourse.steps?.length || 0} 课时）</h4>
                  {previewCourse.steps?.length > 0 ? (
                    <div className="space-y-2">
                      {previewCourse.steps.map((s: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 bg-slate-700/40 rounded-lg p-3">
                          <span className="text-xs font-mono text-slate-500 mt-0.5 w-5 flex-shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-slate-200">{s.title}</span>
                              {s.assigneeRole && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                  s.assigneeRole === 'agent' ? 'bg-blue-500/20 text-blue-400'
                                  : s.assigneeRole === 'sub-agent' ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-purple-500/20 text-purple-400'
                                }`}>
                                  {s.assigneeRole === 'agent' ? 'Agent' : s.assigneeRole === 'sub-agent' ? '子Agent' : '人类'}
                                </span>
                              )}
                              {s.requiresApproval && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400">需审批</span>
                              )}
                            </div>
                            {s.description && <p className="text-xs text-slate-400 line-clamp-2">{s.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">暂无课程步骤</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex items-center gap-2">
        {[
          { value: 'pending', label: '待审核' },
          { value: 'approved', label: '已上线' },
          { value: 'takedown', label: '已下架' },
          { value: 'rejected', label: '已驳回' },
          { value: 'all', label: '全部' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-3 py-1.5 rounded-lg transition ${
              filter === f.value
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 课程列表 */}
      <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-100">课程列表 ({courses.length})</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">加载中...</div>
        ) : courses.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {filter === 'pending' ? '没有待审核的课程' : '没有课程'}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {courses.map(c => (
              <div key={c.id} className="px-6 py-4 hover:bg-slate-900 transition">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{c.icon || '🎓'}</span>
                      <h4 className="font-medium text-slate-100 truncate">{c.name}</h4>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        c.reviewStatus === 'approved' && c.isPublic === false
                          ? 'bg-orange-100 text-orange-700'
                          : statusLabel[c.reviewStatus]?.color || ''
                      }`}>
                        {c.reviewStatus === 'approved' && c.isPublic === false
                          ? '已下架'
                          : statusLabel[c.reviewStatus]?.text || c.reviewStatus}
                      </span>
                    </div>
                    {c.description && (
                      <p className="text-xs text-slate-400 line-clamp-1 mb-1">{c.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{courseTypeLabel[c.courseType] || c.courseType}</span>
                      <span>{c.price ? `${c.price} Token` : '免费'}</span>
                      <span>{c.stepsCount} 课时</span>
                      <span>{c._count?.enrollments || 0} 人报名</span>
                      <span>创建者: {c.creator?.name || c.creator?.email}</span>
                      <span>{new Date(c.createdAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                    {c.reviewNote && (
                      <p className="mt-1 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">
                        审核备注: {c.reviewNote}
                      </p>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    {/* 查看内容 */}
                    <button
                      onClick={() => openPreview(c.id)}
                      className="text-xs px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition"
                    >
                      👁 查看
                    </button>
                    {c.reviewStatus === 'pending' && (
                      <>
                        {reviewingId === c.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={reviewNote}
                              onChange={e => setReviewNote(e.target.value)}
                              placeholder="审核备注（可选）"
                              className="w-40 text-xs px-2 py-1 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                              onClick={() => handleReview(c.id, 'approve')}
                              disabled={actionLoading}
                              className="text-xs px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                            >
                              ✓ 通过
                            </button>
                            <button
                              onClick={() => handleReview(c.id, 'reject')}
                              disabled={actionLoading}
                              className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                            >
                              ✕ 驳回
                            </button>
                            <button
                              onClick={() => { setReviewingId(null); setReviewNote('') }}
                              className="text-xs text-slate-500 hover:text-slate-300"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setReviewingId(c.id)}
                            className="text-xs px-3 py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600"
                          >
                            审核
                          </button>
                        )}
                      </>
                    )}
                    {c.reviewStatus === 'approved' && c.isPublic !== false && (
                      <button
                        onClick={() => { if (confirm(`确定下架「${c.name}」吗？`)) handleReview(c.id, 'takedown') }}
                        disabled={actionLoading}
                        className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                      >
                        ⬇ 下架
                      </button>
                    )}
                    {c.reviewStatus === 'approved' && c.isPublic === false && (
                      <button
                        onClick={() => handleReview(c.id, 'restore')}
                        disabled={actionLoading}
                        className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                      >
                        ⬆ 恢复上架
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 激活码管理组件 ============
function ActivationTab({ codes, setCodes, stats, setStats, genCount, setGenCount, genCredits, setGenCredits, genDays, setGenDays, genNote, setGenNote, genLoading, setGenLoading, newCodes, setNewCodes, copied, setCopied }: any) {
  useEffect(() => { fetchCodes() }, [])

  const fetchCodes = async () => {
    try {
      const res = await fetch('/api/admin/activation')
      if (res.ok) {
        const data = await res.json()
        setCodes(data.codes || [])
        setStats(data.stats || null)
      }
    } catch (e) { console.error('获取激活码失败', e) }
  }

  const generate = async () => {
    setGenLoading(true)
    setNewCodes([])
    try {
      const res = await fetch('/api/admin/activation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: genCount, credits: genCredits, expiresInDays: genDays, note: genNote }),
      })
      const data = await res.json()
      if (res.ok) {
        setNewCodes(data.codes)
        setGenNote('')
        fetchCodes()
      } else {
        alert(data.error || '生成失败')
      }
    } catch { alert('生成失败') }
    finally { setGenLoading(false) }
  }

  const copyAllCodes = () => {
    const text = newCodes.join('\n')
    navigator.clipboard?.writeText(text).catch(() => {
      const el = document.createElement('textarea')
      el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el)
    })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* 统计 */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: '总计', value: stats.total, color: 'indigo' },
            { label: '可用', value: stats.available, color: 'green' },
            { label: '已用', value: stats.used, color: 'orange' },
            { label: '过期', value: stats.expired, color: 'gray' },
          ].map(s => (
            <div key={s.label} className="bg-slate-800 rounded-xl border border-slate-700/50 p-4 text-center">
              <div className={`text-2xl font-bold text-${s.color}-600`}>{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 生成表单 */}
      <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 p-6">
        <h3 className="font-semibold text-slate-100 mb-4">🎫 生成激活码</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">数量</label>
            <input type="number" value={genCount} onChange={e => setGenCount(Number(e.target.value))}
              min={1} max={50}
              className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Token/码</label>
            <input type="number" value={genCredits} onChange={e => setGenCredits(Number(e.target.value))}
              min={1}
              className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">有效天数</label>
            <input type="number" value={genDays} onChange={e => setGenDays(Number(e.target.value))}
              min={1} max={365}
              className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">备注</label>
            <input type="text" value={genNote} onChange={e => setGenNote(e.target.value)}
              placeholder="如：微信付款 ¥99"
              className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
        </div>
        <button onClick={generate} disabled={genLoading}
          className="px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg hover:from-indigo-600 hover:to-purple-600 transition disabled:opacity-50 text-sm">
          {genLoading ? '生成中...' : `生成 ${genCount} 个激活码`}
        </button>

        {/* 新生成的码 */}
        {newCodes.length > 0 && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-green-700">✅ 新生成 {newCodes.length} 个激活码：</span>
              <button onClick={copyAllCodes}
                className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                {copied ? '已复制!' : '全部复制'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {newCodes.map((c: string) => (
                <code key={c} className="bg-slate-800 px-2 py-1 rounded text-xs font-mono text-green-800 border border-green-100 text-center">
                  {c}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 激活码列表 */}
      <div className="bg-slate-800 rounded-2xl shadow-lg shadow-black/20 border border-slate-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-100">全部激活码</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-400 text-xs">
                <th className="px-4 py-3 text-left">激活码</th>
                <th className="px-4 py-3 text-left">Token</th>
                <th className="px-4 py-3 text-left">状态</th>
                <th className="px-4 py-3 text-left">使用者</th>
                <th className="px-4 py-3 text-left">备注</th>
                <th className="px-4 py-3 text-left">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c: any) => {
                const isUsed = !!c.usedAt
                const isExpired = !isUsed && new Date(c.expiresAt) < new Date()
                return (
                  <tr key={c.id} className="border-t border-slate-700 hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-200">{c.code}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">{c.credits}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        isUsed ? 'bg-green-100 text-green-700' :
                        isExpired ? 'bg-slate-800 text-slate-400' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {isUsed ? '已使用' : isExpired ? '已过期' : '可用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {c.usedByUser ? `${c.usedByUser.name || c.usedByUser.email}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{c.note || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(c.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                  </tr>
                )
              })}
              {codes.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500 text-sm">暂无激活码</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============ 组织管理组件 ============
function OrgsManagementTab() {
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => { loadWorkspaces() }, [])

  const loadWorkspaces = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/workspaces')
      if (res.ok) {
        const data = await res.json()
        setWorkspaces(data.workspaces || [])
      }
    } catch {}
    setLoading(false)
  }

  const handleToggleOrg = async (wsId: string, currentType: string) => {
    const isOrg = currentType === 'organization'
    setSaving(wsId)
    try {
      const res = await fetch(`/api/admin/workspaces/${wsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: isOrg ? 'normal' : 'organization',
          orgType: isOrg ? null : 'academy',
        }),
      })
      if (res.ok) {
        setWorkspaces(prev => prev.map(ws =>
          ws.id === wsId ? { ...ws, type: isOrg ? 'normal' : 'organization', orgType: isOrg ? null : 'academy' } : ws
        ))
      }
    } catch {}
    setSaving(null)
  }

  const handleSetOrgType = async (wsId: string, orgType: string) => {
    setSaving(wsId)
    try {
      const res = await fetch(`/api/admin/workspaces/${wsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgType }),
      })
      if (res.ok) {
        setWorkspaces(prev => prev.map(ws =>
          ws.id === wsId ? { ...ws, orgType } : ws
        ))
      }
    } catch {}
    setSaving(null)
  }

  const handleUpdateOrgName = async (wsId: string, orgName: string) => {
    setSaving(wsId)
    try {
      const res = await fetch(`/api/admin/workspaces/${wsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName: orgName || null }),
      })
      if (res.ok) {
        setWorkspaces(prev => prev.map(ws =>
          ws.id === wsId ? { ...ws, orgName: orgName || null } : ws
        ))
      }
    } catch {}
    setSaving(null)
  }

  const orgTypeLabels: Record<string, { label: string; icon: string }> = {
    academy: { label: '高校', icon: '🏫' },
    enterprise: { label: '企业', icon: '🏢' },
    studio: { label: '工作室', icon: '🎨' },
  }

  if (loading) return <div className="text-center py-10 text-slate-500">加载中...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">🏛️ 组织管理</h2>
        <p className="text-xs text-slate-500">
          已授权组织: {workspaces.filter(w => w.type === 'organization').length} / {workspaces.length}
        </p>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">工作区</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Owner</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">成员</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">课程</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">组织类型</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {workspaces.map(ws => {
              const isOrg = ws.type === 'organization'
              return (
                <tr key={ws.id} className={isOrg ? 'bg-indigo-50/50' : ''}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isOrg && <span className="text-sm">{orgTypeLabels[ws.orgType]?.icon || '🏛️'}</span>}
                      <div>
                        <p className="font-medium text-white">{ws.orgName || ws.name}</p>
                        {isOrg && ws.orgName && <p className="text-[10px] text-slate-500">原: {ws.name}</p>}
                        {!isOrg && ws.description && <p className="text-xs text-slate-500 truncate max-w-xs">{ws.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {ws.owner?.name || ws.owner?.email || '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-300">{ws.memberCount}</td>
                  <td className="px-4 py-3 text-center text-xs text-slate-300">{ws.courseCount}</td>
                  <td className="px-4 py-3 text-center">
                    {isOrg ? (
                      <div className="space-y-1">
                        <select
                          value={ws.orgType || 'academy'}
                          onChange={e => handleSetOrgType(ws.id, e.target.value)}
                          disabled={saving === ws.id}
                          className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400"
                        >
                          <option value="academy">🏫 高校</option>
                          <option value="enterprise">🏢 企业</option>
                          <option value="studio">🎨 工作室</option>
                        </select>
                        <input
                          type="text"
                          placeholder="组织显示名称"
                          defaultValue={ws.orgName || ''}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            if (v !== (ws.orgName || '')) handleUpdateOrgName(ws.id, v)
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          className="w-full text-xs border border-slate-700 rounded px-2 py-1 focus:outline-none focus:border-indigo-400 text-center"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">普通工作区</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleOrg(ws.id, ws.type)}
                      disabled={saving === ws.id}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 ${
                        isOrg
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                      }`}
                    >
                      {saving === ws.id ? '...' : isOrg ? '取消组织' : '授权为组织'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

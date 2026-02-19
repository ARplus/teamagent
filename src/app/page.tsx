'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { NotificationBell } from '@/components/NotificationBell'
import LandingPage from '@/components/LandingPage'
import { PairingModal } from '@/components/PairingModal'

// ============ Types ============

interface Agent {
  id: string
  name: string
  avatar: string | null
  status: string
}

interface Submission {
  id: string
  result: string
  summary: string | null
  status: string
  createdAt: string
  durationMs: number | null
  submitter: { id: string; name: string | null; email: string }
  reviewedAt: string | null
  reviewedBy: { id: string; name: string | null; email: string } | null
  reviewNote: string | null
  attachments: { id: string; name: string; url: string }[]
}

interface TaskStep {
  id: string
  title: string
  description: string | null
  order: number
  status: string
  agentStatus: string | null
  result: string | null
  summary: string | null
  assignee?: { 
    id: string
    name: string | null
    avatar: string | null
    agent?: Agent | null
  }
  assigneeNames?: string
  inputs?: string
  outputs?: string
  skills?: string
  attachments: { id: string; name: string; url: string }[]
  agentDurationMs?: number | null
  humanDurationMs?: number | null
  rejectionCount?: number
  rejectionReason?: string | null
  // 会议专用
  stepType?: string        // 'task' | 'meeting'
  scheduledAt?: string | null
  agenda?: string | null
  participants?: string    // JSON string
}

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
  createdAt: string
  updatedAt: string
  creator?: { id: string; name: string | null; email: string }
  workspace?: { id: string; name: string }
  steps?: TaskStep[]
  totalAgentTimeMs?: number | null
  totalHumanTimeMs?: number | null
  agentWorkRatio?: number | null
}

// ============ Utils ============

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function parseJSON(str: string | undefined | null): string[] {
  if (!str) return []
  try {
    return Array.isArray(JSON.parse(str)) ? JSON.parse(str) : []
  } catch { return [] }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// ============ Status Config ============

const statusConfig: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  todo: { label: '待办', color: 'text-slate-600', bg: 'bg-slate-100', dot: 'bg-slate-400' },
  in_progress: { label: '进行中', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
  review: { label: '审核中', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500' },
  done: { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
  pending: { label: '等待', color: 'text-slate-500', bg: 'bg-slate-100', dot: 'bg-slate-400' },
  waiting_approval: { label: '待审批', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500' }
}

const agentStatusConfig: Record<string, { dot: string; label: string }> = {
  online: { dot: 'bg-emerald-500', label: '在线' },
  working: { dot: 'bg-blue-500', label: '工作中' },
  waiting: { dot: 'bg-amber-500', label: '等待中' },
  offline: { dot: 'bg-slate-400', label: '离线' }
}

// ============ Left Sidebar: Task List ============

function TaskList({ 
  tasks, 
  selectedId, 
  onSelect,
  onCreateNew,
  onPairAgent,
  collapsed,
  onToggleCollapse,
  hasAgent
}: { 
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNew: () => void
  onPairAgent: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  hasAgent: boolean
}) {
  const [search, setSearch] = useState('')
  
  const filtered = tasks.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase())
  )

  const inProgress = filtered.filter(t => t.status === 'in_progress' || t.status === 'review')
  const todo = filtered.filter(t => t.status === 'todo')
  const done = filtered.filter(t => t.status === 'done')

  if (collapsed) {
    return (
      <div className="w-16 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center py-4 space-y-4">
        <button 
          onClick={onToggleCollapse}
          className="w-10 h-10 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
        >
          ☰
        </button>
        <div className="flex-1" />
        <button
          onClick={onPairAgent}
          title={hasAgent ? '配对新 Agent' : '还没有 Agent，点击配对'}
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm transition-colors shadow-lg ${
            hasAgent
              ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              : 'bg-amber-500 hover:bg-amber-400 text-white animate-pulse shadow-amber-500/30'
          }`}
        >
          🤖
        </button>
        <button 
          onClick={onCreateNew}
          className="w-10 h-10 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 flex items-center justify-center text-white transition-colors shadow-lg shadow-orange-500/30"
        >
          +
        </button>
      </div>
    )
  }

  return (
    <div className="w-72 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">🦞</span>
          <span className="font-bold text-white text-lg">TeamAgent</span>
        </div>
        <button 
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-lg hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
        >
          ◀
        </button>
      </div>

      <div className="px-4 mb-4">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务..."
            className="w-full bg-slate-800/50 text-slate-200 placeholder-slate-500 rounded-xl px-4 py-2.5 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 border border-slate-700/50"
          />
          <span className="absolute left-3 top-2.5 text-slate-500">🔍</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-4">
        {inProgress.length > 0 && (
          <TaskGroup title="进行中" tasks={inProgress} selectedId={selectedId} onSelect={onSelect} dot="bg-blue-500" />
        )}
        {todo.length > 0 && (
          <TaskGroup title="待办" tasks={todo} selectedId={selectedId} onSelect={onSelect} dot="bg-slate-400" />
        )}
        {done.length > 0 && (
          <TaskGroup title="已完成" tasks={done} selectedId={selectedId} onSelect={onSelect} dot="bg-emerald-500" />
        )}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            {search ? '没有找到匹配的任务' : '暂无任务'}
          </div>
        )}
      </div>

      <div className="p-4 space-y-2">
        {/* 配对 Agent 按钮 */}
        <button
          onClick={onPairAgent}
          className={`w-full py-2.5 rounded-xl font-medium transition-all flex items-center justify-center space-x-2 text-sm ${
            hasAgent
              ? 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
              : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 animate-pulse'
          }`}
        >
          <span>🤖</span>
          <span>{hasAgent ? '⊕ 配对新 Agent' : '⊕ 配对我的 Agent'}</span>
          {!hasAgent && <span className="w-2 h-2 rounded-full bg-amber-400" />}
        </button>

        <button
          onClick={onCreateNew}
          className="w-full py-3 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white rounded-xl font-medium transition-all shadow-lg shadow-orange-500/25 flex items-center justify-center space-x-2"
        >
          <span className="text-lg">+</span>
          <span>新建任务</span>
        </button>
      </div>
    </div>
  )
}

function TaskGroup({ title, tasks, selectedId, onSelect, dot }: { 
  title: string; tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void; dot: string 
}) {
  return (
    <div>
      <div className="flex items-center space-x-2 px-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</span>
        <span className="text-xs text-slate-600">({tasks.length})</span>
      </div>
      <div className="space-y-1">
        {tasks.map(task => (
          <TaskItem key={task.id} task={task} selected={task.id === selectedId} onClick={() => onSelect(task.id)} />
        ))}
      </div>
    </div>
  )
}

function TaskItem({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
  const stepsTotal = task.steps?.length || 0
  const stepsDone = task.steps?.filter(s => s.status === 'done').length || 0
  const hasWaiting = task.steps?.some(s => s.status === 'waiting_approval')

  return (
    <div
      onClick={onClick}
      className={`px-3 py-3 rounded-xl cursor-pointer transition-all ${
        selected 
          ? 'bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/20' 
          : 'hover:bg-slate-800/50 text-slate-300'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${selected ? 'text-white' : 'text-slate-200'}`}>
            {task.title}
          </div>
          <div className={`text-xs mt-1 flex items-center space-x-2 ${selected ? 'text-orange-100' : 'text-slate-500'}`}>
            {stepsTotal > 0 && <span>{stepsDone}/{stepsTotal} 步骤</span>}
            <span>{formatTime(task.updatedAt)}</span>
          </div>
        </div>
        {hasWaiting && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${selected ? 'bg-white/20' : 'bg-amber-500/20 text-amber-400'}`}>
            待审
          </span>
        )}
      </div>
    </div>
  )
}

// ============ Smart Alerts ============

function getTaskAlerts(task: Task): { type: 'warning' | 'success' | 'info'; message: string }[] {
  const alerts: { type: 'warning' | 'success' | 'info'; message: string }[] = []
  
  // 检查截止日期
  if (task.dueDate) {
    const due = new Date(task.dueDate)
    const now = new Date()
    const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysLeft < 0 && task.status !== 'done') {
      alerts.push({ type: 'warning', message: `⚠️ 已超期 ${Math.abs(daysLeft)} 天！` })
    } else if (daysLeft <= 3 && daysLeft >= 0 && task.status !== 'done') {
      alerts.push({ type: 'warning', message: `⏰ 还剩 ${daysLeft} 天截止` })
    }
  }
  
  // 检查是否有待审批
  const waitingSteps = task.steps?.filter(s => s.status === 'waiting_approval') || []
  if (waitingSteps.length > 0) {
    alerts.push({ type: 'info', message: `👀 ${waitingSteps.length} 个步骤待审核` })
  }
  
  // 检查打回次数
  const totalRejections = task.steps?.reduce((sum, s) => sum + (s.rejectionCount || 0), 0) || 0
  if (totalRejections >= 3) {
    alerts.push({ type: 'warning', message: `🔄 已打回 ${totalRejections} 次，建议检查任务描述` })
  }
  
  // 检查是否提前完成
  if (task.status === 'done' && task.dueDate) {
    const due = new Date(task.dueDate)
    const completed = new Date(task.updatedAt)
    if (completed < due) {
      const daysEarly = Math.ceil((due.getTime() - completed.getTime()) / (1000 * 60 * 60 * 24))
      alerts.push({ type: 'success', message: `🎉 提前 ${daysEarly} 天完成！` })
    }
  }
  
  // 如果没有任何警告，显示正常状态
  if (alerts.length === 0) {
    const doneSteps = task.steps?.filter(s => s.status === 'done').length || 0
    const totalSteps = task.steps?.length || 0
    
    if (task.status === 'done') {
      alerts.push({ type: 'success', message: `🦞 任务已完成，干得漂亮！` })
    } else if (totalSteps > 0) {
      const progress = Math.round((doneSteps / totalSteps) * 100)
      if (task.dueDate) {
        const due = new Date(task.dueDate)
        const now = new Date()
        const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        alerts.push({ type: 'success', message: `🦞 进度 ${progress}%，还有 ${daysLeft} 天，一切正常！` })
      } else {
        alerts.push({ type: 'success', message: `🦞 进度 ${progress}%，一切正常，我在监控着～` })
      }
    } else {
      alerts.push({ type: 'info', message: `🦞 等待 AI 拆解任务，准备就绪！` })
    }
  }
  
  return alerts
}

// ============ Right Panel: Task Detail ============

function TaskDetail({ task, onRefresh, canApprove, onDelete, myAgent }: { 
  task: Task; onRefresh: () => void; canApprove: boolean; onDelete: () => void; myAgent?: { name: string; status: string } | null
}) {
  const status = statusConfig[task.status] || statusConfig.todo
  const alerts = getTaskAlerts(task)
  const [showInvite, setShowInvite] = useState(false)
  const [copied, setCopied] = useState(false)

  const inviteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/tasks/${task.id}`
    : `/tasks/${task.id}`

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 点击弹窗外部关闭
  useEffect(() => {
    if (!showInvite) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-invite-popup]')) setShowInvite(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showInvite])

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-slate-50 to-orange-50/30 overflow-hidden">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/50 px-8 py-4">
        <div>
        {/* Top bar: workspace + my agent */}
        <div className="flex items-center justify-between mb-3 text-xs">
          <div className="flex items-center space-x-4 text-slate-500">
            <span>📁 {task.workspace?.name || '默认工作区'}</span>
            <span>·</span>
            <span>👤 {task.creator?.name || task.creator?.email}</span>
            <span>·</span>
            <span>{formatTime(task.createdAt)}</span>
          </div>
          <div className="flex items-center space-x-3">
            {/* My Agent with Alerts */}
            {myAgent && (
              <div className="flex items-center space-x-3">
                {/* Agent 提醒气泡 */}
                {alerts.length > 0 && (
                  <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-2xl shadow-lg border border-slate-200 relative">
                    {/* 小三角指向 Agent */}
                    <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[8px] border-l-white" />
                    <div className="absolute -right-[9px] top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[8px] border-l-slate-200" style={{zIndex: -1}} />
                    <div className="flex flex-wrap gap-1.5 max-w-md">
                      {alerts.map((alert, i) => (
                        <span key={i} className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          alert.type === 'warning' ? 'bg-amber-100 text-amber-700' :
                          alert.type === 'success' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {alert.message}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Agent 头像 */}
                <div className="flex items-center space-x-2 bg-gradient-to-r from-orange-100 to-rose-100 px-3 py-2 rounded-2xl border border-orange-200 shadow-sm">
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-r from-orange-400 to-rose-500 flex items-center justify-center text-white text-sm font-bold shadow-md">
                    🦞
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{myAgent.name}</div>
                    <div className="flex items-center space-x-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${myAgent.status === 'online' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="text-xs text-slate-500">{myAgent.status === 'online' ? '守护中' : '离线'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* 邀请协作者 */}
            <div className="relative" data-invite-popup>
              <button
                onClick={() => setShowInvite(v => !v)}
                className={`flex items-center space-x-1.5 text-sm px-3 py-1.5 rounded-xl transition-colors ${
                  showInvite
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-transparent'
                }`}
                title="邀请协作者"
              >
                <span>👥</span>
                <span className="text-xs font-medium">邀请</span>
              </button>

              {/* 邀请弹窗 */}
              {showInvite && (
                <div className="absolute right-0 top-10 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 z-30">
                  {/* 小箭头 */}
                  <div className="absolute -top-2 right-4 w-4 h-4 bg-white border-l border-t border-slate-200 rotate-45" />

                  <div className="mb-4">
                    <h3 className="font-semibold text-slate-900 text-sm mb-1">邀请协作者</h3>
                    <p className="text-xs text-slate-500">分享链接，对方登录后可查看任务并参与协作</p>
                  </div>

                  {/* 链接复制区 */}
                  <div className="flex items-center space-x-2 mb-4">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600 truncate font-mono">
                      {inviteUrl}
                    </div>
                    <button
                      onClick={handleCopyLink}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${
                        copied
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-400 hover:to-rose-400'
                      }`}
                    >
                      {copied ? '✓ 已复制' : '复制'}
                    </button>
                  </div>

                  {/* 当前协作者 */}
                  {(task.steps?.some(s => s.assignee)) && (
                    <div>
                      <div className="text-xs text-slate-400 mb-2 font-medium">当前协作者</div>
                      <div className="flex flex-wrap gap-2">
                        {/* 去重显示已参与的人+Agent */}
                        {Array.from(
                          new Map(
                            task.steps
                              ?.filter(s => s.assignee)
                              .map(s => [s.assignee!.id, s.assignee!])
                          ).values()
                        ).map(assignee => (
                          <div key={assignee.id} className="flex items-center space-x-1.5 bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-100">
                            <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                              {(assignee.name || 'U')[0]}
                            </div>
                            <div className="text-xs">
                              <div className="text-slate-700 font-medium">{assignee.name || assignee.email?.split('@')[0]}</div>
                              {assignee.agent && (
                                <div className="text-slate-400">🤖 {assignee.agent.name}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setShowInvite(false)}
                    className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* 通知铃铛 */}
            <NotificationBell />
            
            <button
              onClick={onDelete}
              className="text-slate-400 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition-colors"
              title="删除任务"
            >
              🗑️
            </button>
          </div>
        </div>

        {/* Title row */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <span className={`text-xs px-3 py-1 rounded-full font-medium ${status.bg} ${status.color}`}>
                {status.label}
              </span>
              {task.dueDate && (
                <span className="text-xs text-slate-500 flex items-center space-x-1">
                  <span>📅</span>
                  <span>{new Date(task.dueDate).toLocaleDateString('zh-CN')}</span>
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{task.title}</h1>
            {task.description && (
              <p className="text-slate-600 text-sm max-w-2xl">{task.description}</p>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex gap-8">
          {/* Left: Team & Stats */}
          <div className="w-64 flex-shrink-0 space-y-4">
            <TeamCard task={task} />
            <StatsCard task={task} />
          </div>

          {/* Right: Workflow */}
          <div className="flex-1 min-w-0">
            <WorkflowPanel task={task} onRefresh={onRefresh} canApprove={canApprove} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TeamCard({ task }: { task: Task }) {
  // 收集 Agent 信息
  const agentMap = new Map<string, { 
    agentName: string
    humanName: string
    status: string
    done: number
    total: number
    agentStatus?: string
  }>()
  
  for (const step of task.steps || []) {
    if (step.assignee) {
      const key = step.assignee.id
      const agent = step.assignee.agent
      const existing = agentMap.get(key)
      
      if (existing) {
        existing.total++
        if (step.status === 'done') existing.done++
        if (step.status === 'in_progress' || step.status === 'waiting_approval') {
          existing.status = step.status
          existing.agentStatus = step.agentStatus || undefined
        }
      } else {
        agentMap.set(key, {
          agentName: agent?.name || '未绑定',
          humanName: step.assignee.name || '未知',
          status: step.status,
          done: step.status === 'done' ? 1 : 0,
          total: 1,
          agentStatus: step.agentStatus || undefined
        })
      }
    }
  }

  const team = Array.from(agentMap.values())

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center space-x-2">
        <span>🤖</span>
        <span>Agent 团队</span>
      </h3>
      {team.length > 0 ? (
        <div className="space-y-3">
          {team.map((m, i) => {
            const agentSt = m.agentStatus ? agentStatusConfig[m.agentStatus] : null
            return (
              <div key={i} className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-50 to-orange-50/50 rounded-xl">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-sm font-bold shadow-md shadow-orange-500/20">
                    {m.agentName.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{m.agentName}</div>
                    <div className="text-xs text-slate-500">👤 {m.humanName}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-600 font-medium">{m.done}/{m.total}</div>
                  {agentSt && (
                    <div className="flex items-center justify-end space-x-1 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${agentSt.dot}`} />
                      <span className="text-xs text-slate-400">{agentSt.label}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-slate-400 text-center py-4">暂无 Agent</div>
      )}
    </div>
  )
}

function StatsCard({ task }: { task: Task }) {
  const totalAgent = task.totalAgentTimeMs || 0
  const totalHuman = task.totalHumanTimeMs || 0
  const total = totalAgent + totalHuman
  
  if (total === 0) return null
  
  const agentPercent = Math.round((totalAgent / total) * 100)

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center space-x-2">
        <span>⏱️</span>
        <span>工作量</span>
      </h3>
      
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-4 flex">
        <div className="bg-gradient-to-r from-orange-400 to-orange-500 h-full transition-all" style={{ width: `${agentPercent}%` }} />
        <div className="bg-gradient-to-r from-purple-400 to-purple-500 h-full transition-all" style={{ width: `${100 - agentPercent}%` }} />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-orange-50 rounded-xl p-3 text-center">
          <div className="text-xs text-orange-600 mb-1">🤖 Agent</div>
          <div className="text-lg font-bold text-orange-700">{agentPercent}%</div>
          <div className="text-xs text-orange-500">{formatDuration(totalAgent)}</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-3 text-center">
          <div className="text-xs text-purple-600 mb-1">👤 人类</div>
          <div className="text-lg font-bold text-purple-700">{100 - agentPercent}%</div>
          <div className="text-xs text-purple-500">{formatDuration(totalHuman)}</div>
        </div>
      </div>
    </div>
  )
}

// ============ Workflow Panel ============

function WorkflowPanel({ task, onRefresh, canApprove }: { task: Task; onRefresh: () => void; canApprove: boolean }) {
  const [parsing, setParsing] = useState(false)
  const [showAddStep, setShowAddStep] = useState(false)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [newStepType, setNewStepType] = useState<'task' | 'meeting'>('task')
  const [newStepAgenda, setNewStepAgenda] = useState('')
  const [newStepParticipants, setNewStepParticipants] = useState('')
  const [newStepScheduledAt, setNewStepScheduledAt] = useState('')
  const [addingStep, setAddingStep] = useState(false)

  const parseTask = async () => {
    if (!task.description) return alert('任务没有描述')
    setParsing(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/parse`, { method: 'POST' })
      if (res.ok) onRefresh()
      else alert('拆解失败')
    } finally {
      setParsing(false)
    }
  }

  const addStep = async () => {
    if (!newStepTitle.trim()) return
    setAddingStep(true)
    try {
      const participants = newStepParticipants
        ? newStepParticipants.split(/[,，]/).map(s => s.trim()).filter(Boolean)
        : []
      const res = await fetch(`/api/tasks/${task.id}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newStepTitle,
          stepType: newStepType,
          agenda: newStepAgenda || undefined,
          participants: participants.length > 0 ? participants : undefined,
          scheduledAt: newStepScheduledAt || undefined,
        })
      })
      if (res.ok) {
        setNewStepTitle('')
        setNewStepType('task')
        setNewStepAgenda('')
        setNewStepParticipants('')
        setNewStepScheduledAt('')
        setShowAddStep(false)
        onRefresh()
      }
    } finally {
      setAddingStep(false)
    }
  }

  const handleApprove = async (stepId: string) => {
    const res = await fetch(`/api/steps/${stepId}/approve`, { method: 'POST' })
    if (res.ok) onRefresh()
    else alert('审批失败')
  }

  const handleReject = async (stepId: string, reason: string) => {
    const res = await fetch(`/api/steps/${stepId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    if (res.ok) onRefresh()
    else alert('打回失败')
  }

  const steps = task.steps?.sort((a, b) => a.order - b.order) || []
  const currentIndex = steps.findIndex(s => s.status !== 'done')
  const progress = steps.length > 0 ? Math.round((steps.filter(s => s.status === 'done').length / steps.length) * 100) : 0

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center space-x-2">
            <span>📋</span>
            <span>工作流程</span>
          </h3>
          {steps.length > 0 && (
            <div className="flex items-center space-x-2">
              <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-orange-400 to-emerald-400 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-slate-500">{progress}%</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {task.description && steps.length === 0 && (
            <button
              onClick={parseTask}
              disabled={parsing}
              className="text-xs bg-gradient-to-r from-orange-500 to-rose-500 text-white px-4 py-2 rounded-xl hover:from-orange-400 hover:to-rose-400 disabled:opacity-50 shadow-md shadow-orange-500/20 font-medium"
            >
              {parsing ? '🤖 拆解中...' : '🤖 AI 拆解'}
            </button>
          )}
          <button
            onClick={() => setShowAddStep(true)}
            className="text-xs text-orange-600 hover:text-orange-700 font-medium px-3 py-2 hover:bg-orange-50 rounded-xl transition-colors"
          >
            + 添加步骤
          </button>
        </div>
      </div>

      {/* Add Step Form */}
      {showAddStep && (
        <div className={`mx-6 mt-4 p-4 rounded-xl border ${newStepType === 'meeting' ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-100'}`}>
          {/* 类型切换 */}
          <div className="flex space-x-2 mb-3">
            <button
              onClick={() => setNewStepType('task')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${newStepType === 'task' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
            >
              <span>📋</span><span>普通步骤</span>
            </button>
            <button
              onClick={() => setNewStepType('meeting')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${newStepType === 'meeting' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
            >
              <span>📅</span><span>会议</span>
            </button>
          </div>

          <input
            type="text"
            value={newStepTitle}
            onChange={(e) => setNewStepTitle(e.target.value)}
            placeholder={newStepType === 'meeting' ? '会议名称，如：Q2 复盘会' : '步骤标题'}
            className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 bg-white mb-2 ${newStepType === 'meeting' ? 'border-blue-200 focus:ring-blue-500/50' : 'border-orange-200 focus:ring-orange-500/50'}`}
            autoFocus
          />

          {newStepType === 'meeting' && (
            <div className="space-y-2">
              <input
                type="text"
                value={newStepParticipants}
                onChange={(e) => setNewStepParticipants(e.target.value)}
                placeholder="参会人（逗号分隔），如：Aurora, Bob, Carol"
                className="w-full px-4 py-2 border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-white"
              />
              <textarea
                value={newStepAgenda}
                onChange={(e) => setNewStepAgenda(e.target.value)}
                placeholder="议程（选填）&#10;1. 回顾Q1进展&#10;2. 讨论Q2目标&#10;3. 确定行动项"
                className="w-full px-4 py-2 border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-white resize-none"
                rows={3}
              />
              <input
                type="datetime-local"
                value={newStepScheduledAt}
                onChange={(e) => setNewStepScheduledAt(e.target.value)}
                className="w-full px-4 py-2 border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-white"
              />
            </div>
          )}

          <div className="flex space-x-2 mt-3">
            <button onClick={addStep} disabled={addingStep || !newStepTitle.trim()}
              className={`px-4 py-2 text-white rounded-xl text-xs font-medium disabled:opacity-50 ${newStepType === 'meeting' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-orange-500 hover:bg-orange-600'}`}>
              {addingStep ? '添加中...' : newStepType === 'meeting' ? '📅 添加会议' : '添加步骤'}
            </button>
            <button onClick={() => { setShowAddStep(false); setNewStepTitle(''); setNewStepType('task') }}
              className="px-4 py-2 text-slate-600 text-xs hover:bg-slate-100 rounded-xl">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="flex-1 overflow-y-auto p-6">
        {steps.length > 0 ? (
          <div className="space-y-3">
            {steps.map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                index={index}
                isActive={index === currentIndex}
                canApprove={canApprove}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <div className="text-5xl mb-3">📝</div>
            <div className="text-sm font-medium">暂无步骤</div>
            <div className="text-xs mt-1">点击"AI 拆解"或"添加步骤"开始</div>
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({
  step, index, isActive, canApprove, onApprove, onReject
}: {
  step: TaskStep; index: number; isActive: boolean; canApprove: boolean
  onApprove: (id: string) => Promise<void>; onReject: (id: string, reason: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<Submission[]>([])
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isMeeting = step.stepType === 'meeting'
  const status = statusConfig[step.status] || statusConfig.pending
  const isWaiting = step.status === 'waiting_approval'
  const agentName = step.assignee?.agent?.name || parseJSON(step.assigneeNames)[0] || '未分配'
  const participantList = parseJSON(step.participants)

  const loadHistory = async () => {
    try {
      const res = await fetch(`/api/steps/${step.id}/history`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data.history || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleExpand = () => {
    const next = !expanded
    setExpanded(next)
    if (next && history.length === 0) loadHistory()
  }

  return (
    <div className={`rounded-2xl border-2 transition-all overflow-hidden ${
      isMeeting
        ? step.status === 'done' ? 'border-blue-200 bg-blue-50/30'
          : isWaiting ? 'border-blue-300 bg-blue-50/50 shadow-md shadow-blue-100'
          : isActive ? 'border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50/50 shadow-md shadow-blue-100'
          : 'border-blue-200/60 bg-white hover:border-blue-300'
        : step.status === 'done' ? 'border-emerald-200 bg-emerald-50/30'
          : isActive ? 'border-orange-300 bg-gradient-to-r from-orange-50 to-rose-50/50 shadow-md shadow-orange-100'
          : isWaiting ? 'border-amber-200 bg-amber-50/30'
          : 'border-slate-200 bg-white hover:border-slate-300'
    }`}>
      {/* Header */}
      <div className="px-5 py-4 cursor-pointer flex items-center justify-between" onClick={handleExpand}>
        <div className="flex items-center space-x-4">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shadow-sm ${
            step.status === 'done'
              ? isMeeting ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white'
              : isMeeting
                ? isActive ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-blue-500/30' : 'bg-blue-100 text-blue-600'
                : isActive ? 'bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-orange-500/30' : 'bg-slate-200 text-slate-500'
          }`}>
            {step.status === 'done' ? '✓' : isMeeting ? '📅' : index + 1}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className={`font-semibold ${step.status === 'done' ? (isMeeting ? 'text-blue-700' : 'text-emerald-700') : 'text-slate-800'}`}>
                {step.title}
              </span>
              {isMeeting && (
                <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-medium">会议</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center space-x-2">
              {isMeeting ? (
                <>
                  {step.scheduledAt && <span>🕐 {new Date(step.scheduledAt).toLocaleString('zh-CN', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
                  {participantList.length > 0 && (
                    <span className="flex items-center space-x-1">
                      {participantList.slice(0, 3).map((p, i) => (
                        <span key={i} className="w-4 h-4 rounded-full bg-blue-200 text-blue-700 text-xs flex items-center justify-center font-bold" title={p}>
                          {p[0]}
                        </span>
                      ))}
                      {participantList.length > 3 && <span className="text-blue-500">+{participantList.length - 3}</span>}
                    </span>
                  )}
                </>
              ) : (
                <span>🤖 {agentName}</span>
              )}
              <span className={`px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>{status.label}</span>
            </div>
          </div>
        </div>
        <span className={`text-slate-400 text-sm transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100/50">

          {/* 会议专属信息块 */}
          {isMeeting && (
            <div className="mt-4 space-y-3">
              {/* 参会人 */}
              {participantList.length > 0 && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="text-xs text-blue-600 font-medium mb-2">👥 参会人员</div>
                  <div className="flex flex-wrap gap-2">
                    {participantList.map((p, i) => (
                      <div key={i} className="flex items-center space-x-1.5 bg-white rounded-xl px-2.5 py-1.5 border border-blue-100 shadow-sm">
                        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                          {p[0]}
                        </div>
                        <span className="text-xs text-slate-700 font-medium">{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 议程 */}
              {step.agenda && (
                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  <div className="text-xs text-indigo-600 font-medium mb-2">📋 会议议程</div>
                  <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{step.agenda}</pre>
                </div>
              )}

              {/* 时间 */}
              {step.scheduledAt && (
                <div className="flex items-center space-x-2 text-xs text-blue-600">
                  <span>🕐</span>
                  <span className="font-medium">
                    {new Date(step.scheduledAt).toLocaleString('zh-CN', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',weekday:'short'})}
                  </span>
                </div>
              )}
            </div>
          )}

          {!isMeeting && step.description && (
            <p className="text-sm text-slate-600 mt-4 p-3 bg-slate-50 rounded-xl">{step.description}</p>
          )}
          {isMeeting && step.description && (
            <p className="text-sm text-slate-600 mt-3 p-3 bg-slate-50 rounded-xl">{step.description}</p>
          )}

          {step.result && (
            <div className={`mt-4 p-4 rounded-xl ${isMeeting ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50'}`}>
              <div className="text-xs text-slate-500 mb-2 font-medium">
                {isMeeting ? '📝 会议纪要' : '📝 提交结果'}
              </div>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{step.result}</pre>
            </div>
          )}

          {step.rejectionReason && step.status === 'pending' && (
            <div className="mt-4 p-4 bg-red-50 rounded-xl border border-red-100">
              <div className="text-xs text-red-600 font-medium">🔄 打回原因</div>
              <div className="text-sm text-red-700 mt-1">{step.rejectionReason}</div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-slate-500 mb-2 font-medium">📜 提交历史 ({history.length})</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.map((sub, i) => (
                  <HistoryItem key={sub.id} submission={sub} defaultOpen={i === 0} />
                ))}
              </div>
            </div>
          )}

          {isWaiting && canApprove && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              {showRejectForm ? (
                <div className="space-y-3">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="请说明打回原因..."
                    className="w-full px-4 py-3 border border-red-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-red-500/50 bg-red-50/50"
                    rows={2}
                    autoFocus
                  />
                  <div className="flex space-x-2">
                    <button 
                      onClick={async () => {
                        if (!rejectReason.trim()) return
                        setSubmitting(true)
                        await onReject(step.id, rejectReason)
                        setSubmitting(false)
                        setShowRejectForm(false)
                        setRejectReason('')
                      }}
                      disabled={submitting || !rejectReason.trim()}
                      className="px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-red-600"
                    >
                      确认打回
                    </button>
                    <button onClick={() => { setShowRejectForm(false); setRejectReason('') }}
                      className="px-4 py-2 text-slate-600 text-sm hover:bg-slate-100 rounded-xl">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex space-x-3">
                  <button
                    onClick={async () => { setSubmitting(true); await onApprove(step.id); setSubmitting(false) }}
                    disabled={submitting}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl text-sm font-semibold hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    ✅ 通过审核
                  </button>
                  <button
                    onClick={() => setShowRejectForm(true)}
                    disabled={submitting}
                    className="flex-1 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100 disabled:opacity-50 border border-red-200"
                  >
                    ❌ 打回修改
                  </button>
                </div>
              )}
            </div>
          )}

          {step.status === 'done' && (step.agentDurationMs || step.humanDurationMs) && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center space-x-4 text-xs text-slate-500">
              {step.agentDurationMs && <span className="bg-orange-50 text-orange-600 px-2 py-1 rounded-lg">🤖 {formatDuration(step.agentDurationMs)}</span>}
              {step.humanDurationMs && <span className="bg-purple-50 text-purple-600 px-2 py-1 rounded-lg">👤 {formatDuration(step.humanDurationMs)}</span>}
              {(step.rejectionCount || 0) > 0 && (
                <span className="bg-red-50 text-red-500 px-2 py-1 rounded-lg">🔄 {step.rejectionCount}次打回</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryItem({ submission, defaultOpen }: { submission: Submission; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  
  const statusStyle: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700'
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-2.5 bg-slate-50 cursor-pointer flex items-center justify-between" onClick={() => setOpen(!open)}>
        <div className="flex items-center space-x-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full font-medium ${statusStyle[submission.status]}`}>
            {submission.status === 'pending' ? '待审' : submission.status === 'approved' ? '通过' : '打回'}
          </span>
          <span className="text-slate-500">{formatTime(submission.createdAt)}</span>
        </div>
        <span className={`text-slate-400 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </div>
      {open && (
        <div className="px-4 py-3 text-sm">
          <pre className="whitespace-pre-wrap font-sans text-slate-700 text-xs bg-slate-50 p-3 rounded-lg">{submission.result}</pre>
          {submission.reviewNote && (
            <div className={`mt-2 p-3 rounded-lg text-xs ${
              submission.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              <span className="font-medium">{submission.reviewedBy?.name}:</span> {submission.reviewNote}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ Create Task Modal ============

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!title.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description })
      })
      if (res.ok) {
        const data = await res.json()
        onCreated(data.id)
      } else alert('创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-lg p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center space-x-3 mb-6">
          <span className="text-3xl">🦞</span>
          <h2 className="text-xl font-bold text-slate-900">新建任务</h2>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">任务名称</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务名称..."
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500/50 focus:border-orange-400"
              autoFocus
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">任务描述（可选）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细描述任务内容，AI 将根据此内容自动拆解步骤..."
              className="w-full px-4 py-3 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-400"
              rows={4}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-8">
          <button onClick={onClose} className="px-5 py-2.5 text-slate-600 hover:text-slate-800 font-medium">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !title.trim()}
            className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl hover:from-orange-400 hover:to-rose-400 disabled:opacity-50 font-semibold shadow-lg shadow-orange-500/25"
          >
            {loading ? '创建中...' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============ Empty State ============

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50/30">
      <div className="text-7xl mb-6">🦞</div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">欢迎使用 TeamAgent</h2>
      <p className="text-slate-500 mb-8">AI 与人类协作的任务管理平台</p>
      <button
        onClick={onCreate}
        className="px-8 py-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-2xl hover:from-orange-400 hover:to-rose-400 font-semibold shadow-xl shadow-orange-500/30 text-lg"
      >
        + 创建第一个任务
      </button>
    </div>
  )
}

// ============ Main App ============

export default function HomePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [myAgent, setMyAgent] = useState<{ name: string; status: string } | null>(null)
  const [agentChecked, setAgentChecked] = useState(false)
  const [showPairingModal, setShowPairingModal] = useState(false)

  // 未登录由下方 LandingPage 处理，不再强制跳转

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      if (res.ok) setTasks(await res.json())
      
      // 获取我的 Agent 信息
      const agentRes = await fetch('/api/agent/status')
      if (agentRes.ok) {
        const data = await agentRes.json()
        if (data.name) {
          setMyAgent({ name: data.name, status: data.status })
        }
      }
      setAgentChecked(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) fetchTasks()
  }, [session, fetchTasks])

  const fetchTaskDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`)
      if (res.ok) setSelectedTask(await res.json())
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    if (selectedId) fetchTaskDetail(selectedId)
    else setSelectedTask(null)
  }, [selectedId, fetchTaskDetail])

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash && tasks.some(t => t.id === hash)) setSelectedId(hash)
    else if (tasks.length > 0 && !selectedId) setSelectedId(tasks[0].id)
  }, [tasks])

  useEffect(() => {
    if (selectedId) window.history.replaceState(null, '', `#${selectedId}`)
  }, [selectedId])

  const handleRefresh = () => {
    if (selectedId) fetchTaskDetail(selectedId)
    fetchTasks()
  }

  const handleDelete = async () => {
    if (!selectedTask || !confirm('确定删除？')) return
    const res = await fetch(`/api/tasks/${selectedTask.id}`, { method: 'DELETE' })
    if (res.ok) {
      setSelectedId(null)
      setSelectedTask(null)
      fetchTasks()
    } else alert('删除失败')
  }

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🦞</div>
          <div className="text-white">加载中...</div>
        </div>
      </div>
    )
  }

  // 未登录 → 显示营销首页
  if (status === 'unauthenticated') {
    return <LandingPage />
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🦞</div>
          <div className="text-white">加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* 无 Agent 引导 Banner */}
      {agentChecked && !myAgent && (
        <div className="bg-gradient-to-r from-orange-500 to-rose-500 text-white px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <span className="text-xl">🤖</span>
            <div>
              <span className="font-semibold">还没有配对的 Agent！</span>
              <span className="text-orange-100 ml-2 text-sm">配对一个 Agent，让它帮你自动完成任务步骤</span>
            </div>
          </div>
          <button
            onClick={() => setShowPairingModal(true)}
            className="bg-white text-orange-600 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-orange-50 transition-colors flex items-center space-x-2 flex-shrink-0"
          >
            <span>⊕</span>
            <span>输入配对码</span>
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <TaskList
          tasks={tasks}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreateNew={() => setShowCreateModal(true)}
          onPairAgent={() => setShowPairingModal(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          hasAgent={!!myAgent}
        />
        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            onRefresh={handleRefresh}
            canApprove={session?.user?.id === selectedTask.creator?.id}
            onDelete={handleDelete}
            myAgent={myAgent}
          />
        ) : (
          <EmptyState onCreate={() => setShowCreateModal(true)} />
        )}
      </div>

      {showCreateModal && (
        <CreateTaskModal onClose={() => setShowCreateModal(false)} onCreated={(id) => { setShowCreateModal(false); fetchTasks(); setSelectedId(id) }} />
      )}

      {showPairingModal && (
        <PairingModal onClose={() => setShowPairingModal(false)} />
      )}
    </div>
  )
}

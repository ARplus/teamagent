'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
  completedAt?: string | null
  approvedAt?: string | null
  rejectedAt?: string | null
  // 申诉机制
  appealText?: string | null
  appealStatus?: string | null
  appealedAt?: string | null
  appealResolvedAt?: string | null
  // 审批设置
  requiresApproval?: boolean   // false = Agent 提交后自动通过
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
  autoSummary?: string | null
  creatorComment?: string | null
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
  hasAgent,
  currentUserId
}: { 
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNew: () => void
  onPairAgent: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  hasAgent: boolean
  currentUserId: string
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
          <TaskGroup title="进行中" tasks={inProgress} selectedId={selectedId} onSelect={onSelect} dot="bg-blue-500" currentUserId={currentUserId} />
        )}
        {todo.length > 0 && (
          <TaskGroup title="待办" tasks={todo} selectedId={selectedId} onSelect={onSelect} dot="bg-slate-400" currentUserId={currentUserId} />
        )}
        {done.length > 0 && (
          <TaskGroup title="已完成" tasks={done} selectedId={selectedId} onSelect={onSelect} dot="bg-emerald-500" currentUserId={currentUserId} />
        )}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            {search ? '没有找到匹配的任务' : '暂无任务'}
          </div>
        )}
      </div>

      <div className="p-4 space-y-2">
        {/* 官网预览 */}
        <a
          href="/landing"
          target="_blank"
          className="w-full py-2 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 flex items-center justify-center space-x-1.5 transition-colors"
        >
          <span>🌐</span>
          <span>查看官网首页</span>
        </a>

        {/* 我的战队 */}
        <a
          href="/team"
          className="w-full py-2 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 flex items-center justify-center space-x-1.5 transition-colors"
        >
          <span>🌊</span>
          <span>我的战队</span>
        </a>

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

function TaskGroup({ title, tasks, selectedId, onSelect, dot, currentUserId = '' }: { 
  title: string; tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void; dot: string; currentUserId?: string
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
          <TaskItem key={task.id} task={task} selected={task.id === selectedId} onClick={() => onSelect(task.id)} currentUserId={currentUserId} />
        ))}
      </div>
    </div>
  )
}

function TaskItem({ task, selected, onClick, currentUserId }: { task: Task; selected: boolean; onClick: () => void; currentUserId: string }) {
  const stepsTotal = task.steps?.length || 0
  const stepsDone = task.steps?.filter(s => s.status === 'done').length || 0
  const hasWaiting = task.steps?.some(s => s.status === 'waiting_approval')

  // 角色标签
  const isCreator = task.creator?.id === currentUserId
  const isCollaborator = !isCreator && task.steps?.some(s => s.assignee?.id === currentUserId)
  const roleLabel = isCreator
    ? { icon: '🏠', text: '我的', color: 'bg-orange-500 text-white' }
    : isCollaborator
    ? { icon: '🤝', text: '协作', color: 'bg-blue-500 text-white' }
    : { icon: '👁', text: '查看', color: 'bg-slate-500 text-slate-200' }

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
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-xs px-1.5 py-0.5 rounded-md shrink-0 ${roleLabel.color}`}>
              {roleLabel.icon} {roleLabel.text}
            </span>
            <span className={`font-medium truncate ${selected ? 'text-white' : 'text-slate-200'}`}>
              {task.title}
            </span>
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

function TaskDetail({ task, onRefresh, canApprove, onDelete, myAgent, currentUserId }: { 
  task: Task; onRefresh: () => void; canApprove: boolean; onDelete: () => void; myAgent?: { name: string; status: string } | null; currentUserId?: string
}) {
  const status = statusConfig[task.status] || statusConfig.todo
  const alerts = getTaskAlerts(task)
  const [showInvite, setShowInvite] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [generatingInvite, setGeneratingInvite] = useState(false)

  const generateInviteUrl = async () => {
    if (inviteUrl) return inviteUrl // 已生成过，复用
    setGeneratingInvite(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/invite`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setInviteUrl(data.inviteUrl)
        return data.inviteUrl
      } else {
        alert(data.error || '生成邀请链接失败')
        return null
      }
    } finally {
      setGeneratingInvite(false)
    }
  }

  const handleCopyLink = async () => {
    const url = await generateInviteUrl()
    if (!url) return
    navigator.clipboard.writeText(url)
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
                onClick={() => { setShowInvite(v => !v); if (!showInvite) generateInviteUrl() }}
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
                    <p className="text-xs text-slate-500">7天有效，对方点击后加入工作区即可协作</p>
                  </div>

                  {/* 链接复制区 */}
                  <div className="flex items-center space-x-2 mb-4">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600 truncate font-mono">
                      {generatingInvite ? '生成中...' : (inviteUrl || '点击复制生成链接')}
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
                              <div className="text-slate-700 font-medium">{assignee.name || '成员'}</div>
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
            <AttachmentsCard taskId={task.id} />
            <SummaryCard task={task} onRefresh={onRefresh} />
          </div>

          {/* Right: Workflow */}
          <div className="flex-1 min-w-0">
            <WorkflowPanel task={task} onRefresh={onRefresh} canApprove={canApprove} currentUserId={currentUserId} />
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

// ============ Attachments Card ============

interface AttachmentItem {
  id: string; name: string; url: string; type: string | null; size: number | null
  uploader: { name: string | null; email: string }
  createdAt: string
}

function fileIcon(type: string | null) {
  if (!type) return '📎'
  if (type.includes('pdf')) return '📄'
  if (type.includes('word') || type.includes('doc')) return '📝'
  if (type.includes('image')) return '🖼️'
  if (type.includes('text') || type.includes('markdown')) return '📃'
  if (type.includes('sheet') || type.includes('csv')) return '📊'
  return '📎'
}
function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function AttachmentsCard({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/tasks/${taskId}/attachments`)
    if (r.ok) { const d = await r.json(); setItems(d.attachments) }
  }, [taskId])

  useEffect(() => { load() }, [load])

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        const form = new FormData()
        form.append('file', f)
        await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form })
      }
      await load()
    } finally { setUploading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('删除这个附件？')) return
    await fetch(`/api/tasks/${taskId}/attachments?attachmentId=${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">📎 参考资料</h3>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg font-medium transition disabled:opacity-50"
        >
          {uploading ? '上传中…' : '+ 上传'}
        </button>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={e => handleUpload(e.target.files)}
          accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg"
        />
      </div>

      {items.length === 0 ? (
        <div
          className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-orange-300 hover:bg-orange-50/30 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
          onDragOver={e => e.preventDefault()}
        >
          <div className="text-2xl mb-1">📁</div>
          <p className="text-xs text-slate-400">拖拽或点击上传参考文档</p>
          <p className="text-xs text-slate-300 mt-0.5">PDF / Word / TXT / 图片 · 最大 20MB</p>
        </div>
      ) : (
        <div
          className="space-y-1.5"
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
          onDragOver={e => e.preventDefault()}
        >
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2 group px-2 py-1.5 rounded-lg hover:bg-slate-50">
              <span className="text-base flex-shrink-0">{fileIcon(item.type)}</span>
              <div className="flex-1 min-w-0">
                <a href={item.url} target="_blank" rel="noreferrer"
                  className="text-xs font-medium text-slate-700 hover:text-orange-500 truncate block transition">
                  {item.name}
                </a>
                <span className="text-xs text-slate-400">{fmtSize(item.size)}</span>
              </div>
              <button onClick={() => handleDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition text-xs flex-shrink-0">
                ✕
              </button>
            </div>
          ))}
          <div className="pt-1 border-t border-slate-50 text-center">
            <button onClick={() => inputRef.current?.click()}
              className="text-xs text-slate-400 hover:text-orange-500 transition">
              + 继续添加文件
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ Summary Card ============

function SummaryCard({ task, onRefresh }: { task: Task; onRefresh: () => void }) {
  const [comment, setComment] = useState(task.creatorComment || '')
  const [editing, setEditing] = useState(!task.creatorComment)
  const [saving, setSaving] = useState(false)

  if (task.status !== 'done') return null

  const saveComment = async () => {
    if (!comment.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorComment: comment.trim() })
      })
      setEditing(false)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-5 border border-green-100 shadow-sm">
      {/* 完成标题 */}
      <div className="flex items-center space-x-2 mb-3">
        <span className="text-lg">🎉</span>
        <h3 className="text-sm font-semibold text-green-800">任务完成</h3>
      </div>

      {/* 自动摘要：时间 + 产出物 */}
      {task.autoSummary && (
        <div className="bg-white/70 rounded-xl p-3 mb-3 space-y-2">
          {task.autoSummary.split('\n').filter(Boolean).map((line, i) => {
            const [label, ...rest] = line.split('：')
            const value = rest.join('：')
            // 产出物单独渲染为 tag 列表
            if (label === '产出物' && value) {
              return (
                <div key={i}>
                  <div className="text-xs text-green-700 font-medium mb-1">📦 {label}</div>
                  <div className="flex flex-wrap gap-1">
                    {value.split('、').map((item, j) => (
                      <span key={j} className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">{item.trim()}</span>
                    ))}
                  </div>
                </div>
              )
            }
            const icons: Record<string, string> = { '开始': '🕐', '完成': '🏁' }
            return (
              <div key={i} className="flex items-center space-x-1.5 text-xs text-slate-600">
                <span>{icons[label] || '·'}</span>
                <span className="text-slate-400">{label}</span>
                <span className="font-medium text-slate-700">{value || line}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* 发起者结语 */}
      <div>
        <div className="text-xs font-medium text-green-700 mb-1.5 flex items-center space-x-1">
          <span>✍️</span>
          <span>发起者结语</span>
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="写几句话记录这次任务的收获、感想或后续计划…"
              className="w-full text-xs rounded-lg border border-green-200 bg-white/80 p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-green-300 text-slate-700 placeholder:text-slate-400"
              rows={3}
            />
            <button
              onClick={saveComment}
              disabled={saving || !comment.trim()}
              className="w-full py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 disabled:opacity-40 transition-colors"
            >
              {saving ? '保存中…' : '💾 保存结语'}
            </button>
          </div>
        ) : (
          <div
            className="bg-white/70 rounded-xl p-3 text-xs text-slate-700 cursor-pointer hover:bg-white/90 transition-colors group"
            onClick={() => setEditing(true)}
          >
            <p className="whitespace-pre-wrap">{task.creatorComment}</p>
            <p className="text-slate-400 mt-1.5 group-hover:text-green-500 transition-colors">点击编辑 ✏️</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Workflow Panel ============

function WorkflowPanel({ task, onRefresh, canApprove, currentUserId }: { task: Task; onRefresh: () => void; canApprove: boolean; currentUserId?: string }) {
  const [parsing, setParsing] = useState(false)
  const [showAddStep, setShowAddStep] = useState(false)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [newStepType, setNewStepType] = useState<'task' | 'meeting'>('task')
  const [newStepAgenda, setNewStepAgenda] = useState('')
  const [newStepParticipants, setNewStepParticipants] = useState('')
  const [newStepScheduledAt, setNewStepScheduledAt] = useState('')
  const [newStepRequiresApproval, setNewStepRequiresApproval] = useState(true)
  const [newStepAssigneeId, setNewStepAssigneeId] = useState<string | null>(null)
  const [addingStep, setAddingStep] = useState(false)
  const [agentList, setAgentList] = useState<Array<{userId: string, name: string, capabilities: string[], email: string}>>([])

  // 加载已注册 Agent 列表
  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : { agents: [] })
      .then(d => setAgentList(d.agents || []))
      .catch(() => {})
  }, [])

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
          requiresApproval: newStepRequiresApproval,
          assigneeId: newStepAssigneeId || undefined,
        })
      })
      if (res.ok) {
        setNewStepTitle('')
        setNewStepType('task')
        setNewStepAgenda('')
        setNewStepParticipants('')
        setNewStepScheduledAt('')
        setNewStepRequiresApproval(true)
        setNewStepAssigneeId(null)
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

  const handleAssign = async (stepId: string, userId: string | null) => {
    const res = await fetch(`/api/steps/${stepId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId: userId })
    })
    if (res.ok) onRefresh()
    else alert('分配失败')
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

          {/* 分配给 Agent */}
          {newStepType === 'task' && agentList.length > 0 && (
            <div className="mb-2">
              <select
                value={newStepAssigneeId || ''}
                onChange={(e) => setNewStepAssigneeId(e.target.value || null)}
                className="w-full px-3 py-2 border border-orange-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 bg-white text-slate-700"
              >
                <option value="">👤 不分配 Agent（人工执行）</option>
                {agentList.map(a => (
                  <option key={a.userId} value={a.userId}>
                    🤖 {a.name}{a.capabilities?.length > 0 ? ` · ${a.capabilities.slice(0,2).join(', ')}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 是否需要人工审批 */}
          <button
            type="button"
            onClick={() => setNewStepRequiresApproval(!newStepRequiresApproval)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all mb-2 ${
              newStepRequiresApproval
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-green-50 text-green-700 border border-green-200'
            }`}
          >
            <span>{newStepRequiresApproval ? '👤' : '🤖'}</span>
            <span>{newStepRequiresApproval ? '需要人工审批' : 'Agent 完成自动通过'}</span>
          </button>

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

          {/* 审批设置 */}
          {newStepType === 'task' && (
            <div
              className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl mt-2 cursor-pointer select-none"
              onClick={() => setNewStepRequiresApproval(!newStepRequiresApproval)}
            >
              <div>
                <div className="text-xs font-medium text-slate-700">
                  {newStepRequiresApproval ? '🔍 需要人工审批' : '⚡ 自动通过'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {newStepRequiresApproval ? 'Agent 提交后等待你审批' : 'Agent 提交后直接完成'}
                </div>
              </div>
              <div className={`w-10 h-5 rounded-full transition-colors relative ${newStepRequiresApproval ? 'bg-orange-400' : 'bg-green-400'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${newStepRequiresApproval ? 'left-0.5' : 'left-5'}`} />
              </div>
            </div>
          )}

          {/* 审批设置 */}
          {newStepType === 'task' && (
            <button
              onClick={() => setNewStepRequiresApproval(!newStepRequiresApproval)}
              className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-lg border transition-all mt-2 mb-1 ${
                newStepRequiresApproval
                  ? 'bg-white border-slate-200 text-slate-600'
                  : 'bg-green-50 border-green-200 text-green-700'
              }`}
            >
              <span>{newStepRequiresApproval ? '🔍' : '✅'}</span>
              <span>{newStepRequiresApproval ? '需要人工审批' : 'Agent 完成后自动通过'}</span>
            </button>
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
                agents={agentList}
                onAssign={handleAssign}
                currentUserId={currentUserId}
                onRefresh={onRefresh}
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
  step, index, isActive, canApprove, onApprove, onReject, agents, onAssign, currentUserId, onRefresh
}: {
  step: TaskStep; index: number; isActive: boolean; canApprove: boolean
  onApprove: (id: string) => Promise<void>; onReject: (id: string, reason: string) => Promise<void>
  agents?: Array<{userId: string; name: string; capabilities: string[]; email: string}>
  onAssign?: (stepId: string, userId: string | null) => Promise<void>
  currentUserId?: string
  onRefresh?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<Submission[]>([])
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [assigneeSelect, setAssigneeSelect] = useState<string>(step.assignee?.id || '')
  const [savingAssignee, setSavingAssignee] = useState(false)
  // 申诉相关状态
  const [showAppealForm, setShowAppealForm] = useState(false)
  const [appealText, setAppealText] = useState('')
  const [appealSubmitting, setAppealSubmitting] = useState(false)
  const [resolveSubmitting, setResolveSubmitting] = useState(false)

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

  const saveAssignee = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onAssign) return
    setSavingAssignee(true)
    try {
      await onAssign(step.id, assigneeSelect || null)
      setEditingAssignee(false)
    } finally {
      setSavingAssignee(false)
    }
  }

  const submitAppeal = async () => {
    if (!appealText.trim()) return
    setAppealSubmitting(true)
    try {
      const res = await fetch(`/api/steps/${step.id}/appeal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appealText: appealText.trim() })
      })
      if (res.ok) {
        setShowAppealForm(false)
        setAppealText('')
        onRefresh?.()
      } else {
        const data = await res.json()
        alert(data.error || '提交申诉失败')
      }
    } finally {
      setAppealSubmitting(false)
    }
  }

  const resolveAppeal = async (decision: 'upheld' | 'dismissed') => {
    setResolveSubmitting(true)
    try {
      const res = await fetch(`/api/steps/${step.id}/resolve-appeal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      })
      if (res.ok) {
        onRefresh?.()
      } else {
        const data = await res.json()
        alert(data.error || '裁定失败')
      }
    } finally {
      setResolveSubmitting(false)
    }
  }

  const isStepAssignee = currentUserId && step.assignee?.id === currentUserId
  const isRejected = step.status === 'pending' && step.rejectedAt

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
              ) : editingAssignee ? (
                /* 内联分配下拉 */
                <span className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                  <select
                    value={assigneeSelect}
                    onChange={e => setAssigneeSelect(e.target.value)}
                    className="text-xs border border-blue-300 rounded px-1 py-0.5 bg-white max-w-[140px]"
                    autoFocus
                  >
                    <option value="">— 不分配 —</option>
                    {(agents || []).map(a => (
                      <option key={a.userId} value={a.userId}>{a.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={saveAssignee}
                    disabled={savingAssignee}
                    className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    {savingAssignee ? '...' : '✓'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingAssignee(false) }}
                    className="text-xs px-1.5 py-0.5 text-slate-500 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <span className="flex items-center space-x-1">
                  <span>🤖 {agentName}</span>
                  {agents && agents.length > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAssigneeSelect(step.assignee?.id || ''); setEditingAssignee(true) }}
                      className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-500 hover:bg-blue-100 border border-blue-200 ml-1"
                    >
                      分配
                    </button>
                  )}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>{status.label}</span>
              {!isMeeting && step.requiresApproval === false && (
                <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 text-xs">✅ 自动通过</span>
              )}
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

          {/* 时间线 */}
          {(step.completedAt || step.approvedAt || step.rejectedAt) && (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              {step.completedAt && (
                <span>📤 提交 {new Date(step.completedAt).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
              )}
              {step.approvedAt && (
                <span className="text-emerald-600">✅ 通过 {new Date(step.approvedAt).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
              )}
              {step.rejectedAt && (
                <span className="text-red-500">↩️ 打回 {new Date(step.rejectedAt).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
              )}
              {step.agentDurationMs && (
                <span>⏱ 执行 {step.agentDurationMs < 60000 ? `${Math.round(step.agentDurationMs/1000)}秒` : `${Math.round(step.agentDurationMs/60000)}分钟`}</span>
              )}
            </div>
          )}

          {step.rejectionReason && step.status === 'pending' && (
            <div className="mt-4 p-4 bg-red-50 rounded-xl border border-red-100">
              <div className="text-xs text-red-600 font-medium">🔄 打回原因</div>
              <div className="text-sm text-red-700 mt-1">{step.rejectionReason}</div>
            </div>
          )}

          {/* ===== 申诉机制 UI ===== */}
          {isRejected && (
            <div className="mt-4">
              {/* Agent 视角：可提交申诉 */}
              {isStepAssignee && (
                <div>
                  {!step.appealStatus && (
                    showAppealForm ? (
                      <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3">
                        <div className="text-xs text-amber-700 font-medium">📋 提交申诉理由</div>
                        <textarea
                          value={appealText}
                          onChange={e => setAppealText(e.target.value)}
                          placeholder="请说明为什么认为此次打回不合理..."
                          className="w-full px-3 py-2 border border-amber-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-amber-400/50 bg-white"
                          rows={3}
                          autoFocus
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={submitAppeal}
                            disabled={appealSubmitting || !appealText.trim()}
                            className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                          >
                            {appealSubmitting ? '提交中...' : '提交申诉'}
                          </button>
                          <button
                            onClick={() => { setShowAppealForm(false); setAppealText('') }}
                            className="px-4 py-2 text-slate-600 text-sm hover:bg-slate-100 rounded-xl"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAppealForm(true)}
                        className="w-full px-4 py-2.5 bg-amber-50 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 border border-amber-200"
                      >
                        📋 提交申诉
                      </button>
                    )
                  )}
                  {step.appealStatus === 'pending' && (
                    <div className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-700 rounded-xl border border-blue-200 text-sm">
                      <span>⏳</span><span>申诉审核中</span>
                    </div>
                  )}
                  {step.appealStatus === 'upheld' && (
                    <div className="flex items-center space-x-2 px-4 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200 text-sm">
                      <span>✅</span><span>申诉成功，待审批</span>
                    </div>
                  )}
                  {step.appealStatus === 'dismissed' && (
                    <div className="flex items-center space-x-2 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
                      <span>❌</span><span>申诉驳回，需重做</span>
                    </div>
                  )}
                </div>
              )}

              {/* 创建者视角：裁定申诉 */}
              {canApprove && step.appealStatus === 'pending' && step.appealText && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3">
                  <div className="text-xs text-amber-700 font-semibold">⚖️ Agent 提出申诉</div>
                  <div className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-amber-100">
                    {step.appealText}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => resolveAppeal('upheld')}
                      disabled={resolveSubmitting}
                      className="flex-1 px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
                    >
                      ✅ 维持申诉
                    </button>
                    <button
                      onClick={() => resolveAppeal('dismissed')}
                      disabled={resolveSubmitting}
                      className="flex-1 px-4 py-2.5 bg-red-100 text-red-700 rounded-xl text-sm font-medium hover:bg-red-200 disabled:opacity-50 border border-red-200"
                    >
                      ❌ 驳回申诉
                    </button>
                  </div>
                </div>
              )}
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
  const [mode, setMode] = useState<'solo' | 'team'>('solo')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!title.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, mode })
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
          {/* 任务模式 */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">任务模式</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('solo')}
                className={`p-3 rounded-xl border-2 text-left transition ${
                  mode === 'solo' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span>🤖</span>
                  <span className={`text-sm font-semibold ${mode === 'solo' ? 'text-orange-700' : 'text-slate-700'}`}>Solo</span>
                </div>
                <p className="text-xs text-slate-500">AI 团队执行</p>
              </button>
              <button
                type="button"
                onClick={() => setMode('team')}
                className={`p-3 rounded-xl border-2 text-left transition ${
                  mode === 'team' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span>👥</span>
                  <span className={`text-sm font-semibold ${mode === 'team' ? 'text-blue-700' : 'text-slate-700'}`}>Team</span>
                </div>
                <p className="text-xs text-slate-500">人类协作</p>
              </button>
            </div>
          </div>

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
            <label className="text-sm font-medium text-slate-700 mb-2 block">任务描述</label>
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

// ============ Onboarding Guide (新用户引导) ============

const WORK_TYPE_OPTIONS = [
  { label: '✍️ 写作/内容', value: 'writing' },
  { label: '💻 代码/技术', value: 'coding' },
  { label: '🎨 设计/创意', value: 'design' },
  { label: '📣 运营/推广', value: 'marketing' },
  { label: '🔬 研究/分析', value: 'research' },
  { label: '💼 销售/商务', value: 'sales' },
  { label: '🏗️ 一人公司', value: 'solo-company' },
  { label: '✨ 其他', value: 'other' },
]

function OnboardingGuide({ onPairAgent, onCreateTask, onSelectTask, hasAgent = false, agentName, currentUserId }: {
  onPairAgent: () => void
  onCreateTask: () => void
  onSelectTask: (id: string) => void
  hasAgent?: boolean
  agentName?: string
  currentUserId?: string
}) {
  const [showTeamForm, setShowTeamForm] = useState(hasAgent) // 有 Agent 时自动展开 Step 2
  const [companyName, setCompanyName] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [goal, setGoal] = useState('')
  const [agentCount, setAgentCount] = useState(3)
  const [submitting, setSubmitting] = useState(false)

  const toggleType = (v: string) =>
    setSelectedTypes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])

  const handleBuildTeam = async () => {
    if (!companyName.trim() || !goal.trim()) return
    setSubmitting(true)
    try {
      const typeLabels = WORK_TYPE_OPTIONS
        .filter(o => selectedTypes.includes(o.value))
        .map(o => o.label)
        .join('、') || '待定'

      const desc =
        `军团名称：${companyName}\n` +
        `工作类型：${typeLabels}\n` +
        `核心目标：${goal}\n` +
        `期望规模：${agentCount} 名 Agent 成员\n\n` +
        `---\n` +
        `请根据以上信息，为我规划并组建最合适的 Agent 军团：\n` +
        `1. 分析工作类型，为每位成员设计专属职责分工\n` +
        `2. 为每位成员取一个有个性的名字 + 专属 emoji（参考风格：🦑 Quill 乌贼文书官、🐡 PufferQA 河豚测试官）\n` +
        `3. 通过 TeamAgent API 注册各成员账号（POST /api/agents/register）\n` +
        `4. 配置各成员的能力标签（capabilities）\n` +
        `5. 汇报军团建设完成，附成员名单与职责表`

      const taskRes = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `🌊 组建「${companyName}」Agent 军团`,
          description: desc,
          mode: 'solo',
        }),
      })
      if (!taskRes.ok) { alert('创建失败，请重试'); return }
      const task = await taskRes.json()

      // 创建第一个步骤，交由主 Agent 规划执行（含完整 API 指令）
      await fetch(`/api/tasks/${task.id}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '🌊 规划军团架构，完成成员注册',
          description:
            `## 任务背景\n` +
            `军团：${companyName} ｜ 目标：${goal} ｜ 规模：${agentCount} 人 ｜ 工作类型：${typeLabels}\n\n` +
            `## 你需要做的事\n` +
            `1. 根据工作类型，为每位成员设计专属职责和个性名字（带 emoji）\n` +
            `2. 用下面的 API 逐一注册成员账号\n` +
            `3. 全部注册完毕后，提交成员名单（含姓名、邮箱、职责）供审批\n\n` +
            `## 注册 API 说明\n` +
            `POST /api/agents/register\n` +
            `Authorization: Bearer <你自己的 token>\n` +
            `Content-Type: application/json\n\n` +
            `请求体：\n` +
            `{\n` +
            `  "name": "🦑 成员名字",         // 带 emoji 的展示名\n` +
            `  "email": "xxx@${companyName.toLowerCase().replace(/\s+/g, '')}.ai",  // 邮箱命名规范\n` +
            `  "password": "lobster-agent-2026",  // 默认密码\n` +
            `  "capabilities": ["能力1","能力2"], // 2-4个能力标签\n` +
            `  "personality": "一句话个性描述"\n` +
            `}\n\n` +
            `注意：每位成员注册成功后会返回 token，请在提交结果时附上成员名单表格。`,
          requiresApproval: true,
          assigneeId: currentUserId || undefined,
        }),
      })

      onSelectTask(task.id)
    } finally {
      setSubmitting(false)
    }
  }

  const step2Action = showTeamForm ? (
    <div className="mt-4 space-y-3">
      {/* 军团名 */}
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">🏢 你的军团/公司叫什么？</label>
        <input
          type="text"
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          placeholder="如：Aurora 宇宙艺术团、极光创作工作室..."
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/50 bg-white"
          autoFocus
        />
      </div>

      {/* 工作类型 */}
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1.5 block">💼 主要做什么类型的工作？（可多选）</label>
        <div className="flex flex-wrap gap-2">
          {WORK_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleType(opt.value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                selectedTypes.includes(opt.value)
                  ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-orange-300 hover:text-orange-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 目标 */}
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">🎯 你最想实现什么？（一句话）</label>
        <input
          type="text"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="如：用 AI 军团帮我独立完成产品开发和运营..."
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/50 bg-white"
        />
      </div>

      {/* Agent 人数 */}
      <div>
        <label className="text-xs font-medium text-slate-600 mb-2 block">
          👥 希望有几名 Agent 成员？<span className="text-orange-500 font-bold ml-1">{agentCount} 名</span>
        </label>
        <div className="flex gap-2">
          {[2, 3, 4, 5, 6].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setAgentCount(n)}
              className={`flex-1 py-1.5 rounded-xl text-sm font-semibold transition-all border ${
                agentCount === n
                  ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-orange-300'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* 提交 */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleBuildTeam}
          disabled={submitting || !companyName.trim() || !goal.trim()}
          className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold hover:from-orange-400 hover:to-rose-400 disabled:opacity-50 shadow-md shadow-orange-500/20 transition-all"
        >
          {submitting ? '🌊 组建中...' : '🌊 让主 Agent 帮我组建'}
        </button>
        <button
          onClick={() => setShowTeamForm(false)}
          className="px-4 py-2.5 text-slate-400 hover:text-slate-600 text-sm rounded-xl hover:bg-slate-100 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  ) : (
    <button
      onClick={() => setShowTeamForm(true)}
      className="mt-3 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl text-sm font-semibold hover:from-blue-400 hover:to-indigo-400 transition shadow-md shadow-blue-500/20"
    >
      🌊 开始组建我的军团 →
    </button>
  )

  // 步骤完成状态：有 Agent = Step 1 完成；Step 2 完成需要有任务（提交后会离开这个页面）
  const step1Done = hasAgent

  const steps = [
    {
      num: 1, icon: step1Done ? '✓' : '🤖',
      title: '配对你的主 Agent',
      desc: step1Done ? '主 Agent 已就位，随时待命 🎉' : '把你的 AI 助手接入平台，它将成为你的数字总指挥，自动认领并执行任务步骤',
      done: step1Done,
      action: step1Done ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-medium border border-emerald-200">
            ✅ {agentName ? `${agentName} 已就位` : '配对成功'}
          </span>
          <button onClick={onPairAgent}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition">
            换绑其他 Agent
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button onClick={onPairAgent} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold hover:from-orange-400 hover:to-rose-400 shadow-md shadow-orange-500/20">⊕ 输入配对码</button>
          <button type="button" onClick={() => window.location.href = '/build-agent'}
            className="text-xs text-slate-400 hover:text-orange-500 transition flex items-center gap-1 underline underline-offset-2">
            📖 查看安装指引 →
          </button>
        </div>
      ),
    },
    {
      num: 2, icon: '🌊',
      title: '告诉主 Agent，你想建什么样的团队',
      desc: '说出你的目标和工作方向，主 Agent 将自动规划军团架构，帮你注册成员、分配职责',
      done: false,
      action: step1Done ? step2Action : (
        <p className="mt-2 text-xs text-slate-400 italic">先完成 Step 1 配对后解锁</p>
      ),
    },
    {
      num: 3, icon: '📋',
      title: '创建第一个任务，出发！',
      desc: '用 Solo 模式创建任务，描述你要做什么，Agent 战队开始自动认领执行，你只需审批关键节点',
      done: false,
      action: <button onClick={onCreateTask} className="mt-3 px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-xl text-sm font-semibold hover:from-slate-600 hover:to-slate-700 transition">+ 创建第一个任务</button>
    },
  ]

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50/20 px-8 py-8 overflow-y-auto">
      <div className="max-w-xl w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🦞</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">欢迎来到 TeamAgent</h2>
          <p className="text-slate-500 text-sm">
            {step1Done ? '🎉 主 Agent 已就位！接下来组建你的军团' : '三步启动你的数字军团，让 AI Agent 替你干活'}
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {steps.map((step, i) => {
            const isActive = (i === 0 && !step1Done) || (i === 1 && step1Done && !step.done)
            const isDone = step.done
            const isLocked = i === 1 && !step1Done

            return (
              <div key={step.num} className="relative">
                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div className={`absolute left-6 top-14 w-0.5 h-6 ${isDone || (i === 0 && step1Done) ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                )}
                <div className={`flex gap-4 bg-white rounded-2xl p-5 shadow-sm border transition-all ${
                  isDone ? 'border-emerald-200 bg-emerald-50/30 opacity-80'
                  : isActive && showTeamForm ? 'border-blue-300 shadow-md shadow-blue-50'
                  : isActive ? 'border-orange-200 shadow-md shadow-orange-50'
                  : isLocked ? 'border-slate-100 opacity-50'
                  : 'border-slate-100 hover:border-orange-200'
                }`}>
                  {/* Step icon */}
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 font-bold text-lg ${
                    isDone ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                    : isActive && showTeamForm ? 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-500/25'
                    : isActive ? 'bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-md shadow-orange-500/25'
                    : 'bg-slate-100 text-slate-400 text-xl'
                  }`}>
                    {isDone ? '✓' : <span className="text-xl">{step.icon}</span>}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                        isDone ? 'bg-emerald-100 text-emerald-600'
                        : isActive && showTeamForm ? 'bg-blue-100 text-blue-600'
                        : isActive ? 'bg-orange-100 text-orange-600'
                        : 'bg-slate-100 text-slate-400'
                      }`}>
                        {isDone ? '✓ 完成' : `STEP ${step.num}`}
                      </span>
                      <h3 className={`font-semibold ${isDone ? 'text-emerald-700' : 'text-slate-800'}`}>
                        {step.title}
                      </h3>
                    </div>
                    <p className="text-slate-500 text-sm mt-1">{step.desc}</p>
                    {step.action}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer hint */}
        {!step1Done && (
          <p className="text-center text-xs text-slate-400 mt-8">
            已有 Agent？直接输入配对码 · 没有 Agent？先去{' '}
            <button type="button" onClick={() => window.location.href = '/build-agent'} className="text-orange-400 hover:text-orange-500 underline underline-offset-2">查看安装指引</button>
          </p>
        )}
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
      {agentChecked && !myAgent && tasks.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-2.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <span className="text-lg">⚡</span>
            <div>
              <span className="font-semibold text-sm">还没有配对 Agent</span>
              <span className="text-amber-100 ml-2 text-xs">配对后任务步骤可以自动执行，不用手动操作</span>
            </div>
          </div>
          <button
            onClick={() => setShowPairingModal(true)}
            className="bg-white text-orange-600 font-semibold px-4 py-1.5 rounded-xl text-xs hover:bg-orange-50 transition-colors flex items-center space-x-1.5 flex-shrink-0"
          >
            <span>⊕</span>
            <span>配对我的 Agent</span>
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
          currentUserId={session?.user?.id || ''}
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
            currentUserId={session?.user?.id || ''}
          />
        ) : agentChecked && tasks.length === 0 ? (
          <OnboardingGuide
            hasAgent={!!myAgent}
            agentName={myAgent?.name}
            currentUserId={session?.user?.id}
            onPairAgent={() => setShowPairingModal(true)}
            onCreateTask={() => setShowCreateModal(true)}
            onSelectTask={(id) => { fetchTasks(); setSelectedId(id) }}
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

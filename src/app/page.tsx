'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { NotificationBell } from '@/components/NotificationBell'
import { Navbar } from '@/components/Navbar'
import LandingPage from '@/components/LandingPage'
import { PairingModal } from '@/components/PairingModal'
import { VoiceMicButton } from '@/components/VoiceMicButton'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ============ Types ============

interface Agent {
  id: string
  name: string
  avatar: string | null
  status: string
  isMainAgent?: boolean
  parentAgent?: { id: string; name: string; user?: { id: string; name: string | null } } | null
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
  attachments: { id: string; name: string; url: string; type?: string | null }[]
}

// B08: 多人指派成员信息
interface StepAssigneeInfo {
  userId: string
  assigneeType: 'agent' | 'human'
  isPrimary?: boolean
  status: string
  user: {
    id: string
    name: string | null
    email?: string
    avatar: string | null
    agent?: { id: string; name: string; status: string } | null
  }
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
    email?: string
    avatar: string | null
    agent?: Agent | null
  }
  assigneeNames?: string
  // B08: 多人指派
  assignees?: StepAssigneeInfo[]
  completionMode?: string  // "all" | "any"
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
  approvedByUser?: { id: string; name: string | null; email: string } | null
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
  mode: string   // solo | team
  dueDate: string | null
  createdAt: string
  updatedAt: string
  creator?: { id: string; name: string | null; email: string }
  workspace?: { id: string; name: string }
  steps?: TaskStep[]
  totalAgentTimeMs?: number | null
  totalHumanTimeMs?: number | null
  agentWorkRatio?: number | null
  supplement?: string | null
  autoSummary?: string | null
  creatorComment?: string | null
  // B12: 评分
  evaluations?: TaskEvaluation[]
  // F04: 编辑元数据
  viewerIsCreator?: boolean
}

interface TaskEvaluation {
  id: string
  memberId: string
  memberName: string | null
  memberType: string
  quality: number
  efficiency: number
  collaboration: number
  overallScore: number
  comment: string | null
  stepsTotal: number
  stepsDone: number
  model?: string
}

interface ChatMessage {
  id: string
  content: string
  role: 'user' | 'agent'
  createdAt: string
}

// ============ Utils ============

// B11: 任务类型 Icon（🤖/👤/🤝）
function getTaskTypeIcon(task: Task): { icon: string; label: string } {
  const steps = task.steps || []
  if (steps.length === 0) return { icon: '📋', label: '待拆解' }

  let hasAgent = false, hasHuman = false
  for (const step of steps) {
    const assigneeList = (step as any).assignees?.length
      ? (step as any).assignees
      : step.assignee
        ? [{ assigneeType: step.assignee.agent ? 'agent' : 'human' }]
        : null
    if (!assigneeList) { hasHuman = true; continue }
    for (const a of assigneeList) {
      if (a.assigneeType === 'agent') hasAgent = true
      else hasHuman = true
    }
  }

  if (hasAgent && hasHuman) return { icon: '🤝', label: '人机协作' }
  if (hasAgent) return { icon: '🤖', label: '纯Agent' }
  return { icon: '👤', label: '纯人类' }
}

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

// ============ Chat Types & Bubble ============

interface ChatMessage {
  id: string
  content: string
  role: 'user' | 'agent'
  createdAt: string
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isPending = message.content === '...' || message.content === '__pending__'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>

      <div
        className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-br-md'
            : 'bg-slate-800 text-slate-200 rounded-bl-md'
        } ${isPending ? 'animate-pulse' : ''}`}
      >
        {isPending ? (
          <span className="tracking-widest text-slate-400">···</span>
        ) : (
          <span className="whitespace-pre-wrap break-words">{message.content}</span>
        )}
      </div>
    </div>
  )
}

// ============ Invite Partner Button ============

function InvitePartnerButton() {
  const [showInput, setShowInput] = useState(false)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const handleInvite = async () => {
    if (!email.trim()) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/workspace/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ text: data.message || '邀请成功！', ok: true })
        setEmail('')
        setTimeout(() => { setShowInput(false); setMsg(null) }, 2000)
      } else {
        setMsg({ text: data.error || '邀请失败', ok: false })
      }
    } catch {
      setMsg({ text: '网络错误', ok: false })
    } finally {
      setLoading(false)
    }
  }

  if (!showInput) {
    return (
      <button
        onClick={() => setShowInput(true)}
        className="w-full py-2 rounded-xl text-xs text-slate-500 hover:text-emerald-300 hover:bg-slate-800/40 flex items-center justify-center space-x-1.5 transition-colors"
      >
        <span>🤝</span>
        <span>邀请协作伙伴</span>
      </button>
    )
  }

  return (
    <div className="w-full bg-slate-800/60 rounded-xl p-2.5 space-y-2 border border-slate-700/50">
      <div className="flex items-center space-x-1.5">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
          placeholder="输入邮箱地址"
          className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          autoFocus
        />
        <button
          onClick={handleInvite}
          disabled={loading || !email.trim()}
          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? '...' : '邀请'}
        </button>
        <button
          onClick={() => { setShowInput(false); setMsg(null) }}
          className="px-1.5 py-1.5 text-slate-500 hover:text-slate-300 text-xs"
        >
          ✕
        </button>
      </div>
      {msg && (
        <div className={`text-xs px-1 ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
          {msg.text}
        </div>
      )}
    </div>
  )
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
        {/* 💬 与 Agent 对话 — 最顶部入口 */}
        <a
          href="/chat"
          className={`w-full py-3 rounded-xl font-medium flex items-center justify-center space-x-2 text-sm transition-all ${
            hasAgent
              ? 'bg-gradient-to-r from-orange-500/20 to-rose-500/20 border border-orange-400/30 hover:border-orange-400/50 text-orange-200 hover:text-white'
              : 'bg-slate-800/40 border border-slate-700/50 text-slate-500 hover:text-slate-300'
          }`}
        >
          <span>💬</span>
          <span>与 Agent 对话</span>
          {hasAgent && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </a>

        {/* 官网预览 */}
        <a
          href="/landing"
          target="_blank"
          className="w-full py-2 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 flex items-center justify-center space-x-1.5 transition-colors"
        >
          <span>🌐</span>
          <span>查看官网首页</span>
        </a>

        {/* 我的工作区 */}
        <a
          href="/workspace"
          className="w-full py-2 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 flex items-center justify-center space-x-1.5 transition-colors"
        >
          <span>🏠</span>
          <span>我的工作区</span>
        </a>

        {/* 邀请协作伙伴 */}
        <InvitePartnerButton />

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
  // B11: 任务类型 Icon
  const taskType = getTaskTypeIcon(task)

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
            <span title={taskType.label} className="shrink-0">{taskType.icon}</span>
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
  const router = useRouter()
  const status = statusConfig[task.status] || statusConfig.todo
  const alerts = getTaskAlerts(task)
  const [showInvite, setShowInvite] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [generatingInvite, setGeneratingInvite] = useState(false)

  // F04: 编辑状态
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description || '')
  const [editPriority, setEditPriority] = useState(task.priority)
  const [saving, setSaving] = useState(false)
  // F04: 补充说明
  const [showSupplement, setShowSupplement] = useState(false)
  const [supplementText, setSupplementText] = useState(task.supplement || '')
  const [savingSupplement, setSavingSupplement] = useState(false)
  // F04: 编辑历史
  const [showHistory, setShowHistory] = useState(false)
  const [editHistory, setEditHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const isCreator = currentUserId === task.creator?.id
  const taskStarted = ['in_progress', 'review', 'done'].includes(task.status)

  // 重置编辑状态当任务变化
  useEffect(() => {
    setEditTitle(task.title)
    setEditDesc(task.description || '')
    setEditPriority(task.priority)
    setSupplementText(task.supplement || '')
    setEditing(false)
  }, [task.id, task.title, task.description, task.priority, task.supplement])

  const handleSaveEdit = async () => {
    if (!editTitle.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDesc.trim() || null,
          priority: editPriority
        })
      })
      if (res.ok) {
        setEditing(false)
        onRefresh()
      } else {
        const data = await res.json()
        alert(data.error || '保存失败')
      }
    } catch { alert('网络错误') }
    finally { setSaving(false) }
  }

  const handleSaveSupplement = async () => {
    if (savingSupplement) return
    setSavingSupplement(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplement: supplementText.trim() || null })
      })
      if (res.ok) {
        setShowSupplement(false)
        onRefresh()
      } else {
        const data = await res.json()
        alert(data.error || '保存失败')
      }
    } catch { alert('网络错误') }
    finally { setSavingSupplement(false) }
  }

  const loadHistory = async () => {
    if (loadingHistory) return
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/history`)
      if (res.ok) {
        const data = await res.json()
        setEditHistory(data.history || [])
        setShowHistory(true)
      }
    } catch { /* ignore */ }
    finally { setLoadingHistory(false) }
  }

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
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/50 px-4 sm:px-8 py-3 sm:py-4">
        <div>
        {/* Top bar: workspace + my agent */}
        <div className="flex items-center justify-between mb-2 sm:mb-3 text-xs flex-wrap gap-2">
          <div className="flex items-center space-x-2 sm:space-x-4 text-slate-500 flex-wrap gap-1">
            <span className="hidden sm:inline">📁 {task.workspace?.name || '默认工作区'}</span>
            <span className="hidden sm:inline">·</span>
            <span>👤 {task.creator?.name || task.creator?.email}</span>
            <span>·</span>
            <span>{formatTime(task.createdAt)}</span>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* My Agent with Alerts - 只在 sm+ 屏幕显示复杂的 Agent 气泡 */}
            {myAgent && (
              <div className="hidden sm:flex items-center space-x-3">
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
                {/* Agent 头像 - 点击进入对话 */}
                <button
                  onClick={() => router.push('/chat')}
                  className="flex items-center space-x-2 bg-gradient-to-r from-orange-100 to-rose-100 px-3 py-2 rounded-2xl border border-orange-200 shadow-sm hover:shadow-md hover:border-orange-300 transition-all"
                  title="和 Agent 对话"
                >
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-r from-orange-400 to-rose-500 flex items-center justify-center text-white text-sm font-bold shadow-md">
                    🦞
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{myAgent.name}</div>
                    <div className="flex items-center space-x-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${myAgent.status === 'online' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="text-xs text-slate-500">{myAgent.status === 'online' ? '💬 对话' : '离线'}</span>
                    </div>
                  </div>
                </button>
              </div>
            )}
            {/* 移动端简化版 Agent 状态 - 点击进入对话 */}
            {myAgent && (
              <button
                onClick={() => router.push('/chat')}
                className="sm:hidden flex items-center space-x-1 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100 active:bg-orange-100"
                title="和 Agent 对话"
              >
                <span className="text-sm">🦞</span>
                <div className={`w-1.5 h-1.5 rounded-full ${myAgent.status === 'online' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              </button>
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
                <div className="absolute right-0 top-10 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 z-30">
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
          <div className="space-y-1.5 sm:space-y-2 min-w-0 flex-1">
            <div className="flex items-center space-x-2 sm:space-x-3 flex-wrap gap-1">
              <span className={`text-xs px-2 sm:px-3 py-1 rounded-full font-medium ${status.bg} ${status.color}`}>
                {status.label}
              </span>
              {task.dueDate && (
                <span className="text-xs text-slate-500 flex items-center space-x-1">
                  <span>📅</span>
                  <span>{new Date(task.dueDate).toLocaleDateString('zh-CN')}</span>
                </span>
              )}
              {/* F04: 编辑/补充按钮 */}
              {isCreator && !editing && (
                <div className="flex items-center gap-1">
                  {!taskStarted ? (
                    <button onClick={() => setEditing(true)}
                      className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition" title="编辑任务">
                      ✏️ 编辑
                    </button>
                  ) : (
                    <button onClick={() => setShowSupplement(!showSupplement)}
                      className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition" title="补充说明">
                      📝 补充说明
                    </button>
                  )}
                  <button onClick={loadHistory} disabled={loadingHistory}
                    className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition" title="编辑历史">
                    {loadingHistory ? '...' : '📜'}
                  </button>
                </div>
              )}
            </div>

            {/* F04: 编辑模式 */}
            {editing ? (
              <div className="space-y-2 max-w-2xl">
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 text-lg font-bold border border-blue-300 rounded-lg bg-white focus:outline-none focus:border-blue-500" />
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                  placeholder="任务描述（可选）"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-500 resize-none" />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">优先级:</label>
                  {(['low','medium','high','urgent'] as const).map(p => (
                    <button key={p} onClick={() => setEditPriority(p)}
                      className={`text-xs px-2 py-1 rounded-full transition ${editPriority === p ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {p === 'low' ? '低' : p === 'medium' ? '中' : p === 'high' ? '高' : '紧急'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveEdit} disabled={!editTitle.trim() || saving}
                    className="px-4 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition disabled:opacity-50">
                    {saving ? '保存中...' : '✅ 保存'}
                  </button>
                  <button onClick={() => { setEditing(false); setEditTitle(task.title); setEditDesc(task.description || ''); setEditPriority(task.priority) }}
                    className="px-4 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200 transition">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-lg sm:text-2xl font-bold text-slate-900 leading-snug">{task.title}</h1>
                {task.description && (
                  <p className="text-slate-600 text-xs sm:text-sm max-w-2xl line-clamp-2 sm:line-clamp-none">{task.description}</p>
                )}
              </>
            )}

            {/* F04: 补充说明 */}
            {task.supplement && !showSupplement && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 max-w-2xl">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-semibold text-amber-700">📝 补充说明</span>
                </div>
                <p className="text-xs text-amber-800 whitespace-pre-wrap">{task.supplement}</p>
              </div>
            )}
            {showSupplement && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 max-w-2xl space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-amber-700">📝 补充说明</span>
                  <span className="text-xs text-amber-500">（任务已开始，可追加补充信息）</span>
                </div>
                <textarea value={supplementText} onChange={e => setSupplementText(e.target.value)} rows={3}
                  placeholder="输入补充说明，参与者会看到..."
                  className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white focus:outline-none focus:border-amber-500 resize-none" />
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveSupplement} disabled={savingSupplement}
                    className="px-4 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 transition disabled:opacity-50">
                    {savingSupplement ? '保存中...' : '💾 保存补充说明'}
                  </button>
                  <button onClick={() => { setShowSupplement(false); setSupplementText(task.supplement || '') }}
                    className="px-4 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200 transition">
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* F04: 编辑历史弹窗 */}
            {showHistory && (
              <div className="bg-white border border-slate-200 rounded-lg p-3 max-w-2xl shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">📜 编辑历史</span>
                  <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                </div>
                {editHistory.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-2">暂无编辑记录</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {editHistory.map((h: any) => (
                      <div key={h.id} className="text-xs border-b border-slate-100 pb-1.5 last:border-0">
                        <div className="flex items-center gap-2 text-slate-500 mb-0.5">
                          <span>{h.editor.name || h.editor.email}</span>
                          <span>·</span>
                          <span>{h.editType === 'supplement' ? '📝补充' : '✏️编辑'}</span>
                          <span>·</span>
                          <span>{new Date(h.createdAt).toLocaleString('zh-CN')}</span>
                        </div>
                        <div className="text-slate-600">
                          <span className="font-medium">{h.fieldName === 'title' ? '标题' : h.fieldName === 'description' ? '描述' : h.fieldName === 'priority' ? '优先级' : h.fieldName === 'supplement' ? '补充说明' : h.fieldName}:</span>
                          {h.oldValue && <span className="line-through text-slate-400 mx-1">{h.oldValue.substring(0, 50)}</span>}
                          {h.oldValue && h.newValue && <span className="text-slate-400">→</span>}
                          {h.newValue && <span className="text-slate-700 ml-1">{h.newValue.substring(0, 80)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-8">
          {/* Left: Team & Stats - 移动端全宽，桌面端固定宽 */}
          <div className="w-full lg:w-64 lg:flex-shrink-0 space-y-4">
            <TeamCard task={task} onRefresh={onRefresh} currentUserId={currentUserId} />
            <StatsCard task={task} />
            <TaskFilesCard taskId={task.id} />
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

function TeamCard({ task, onRefresh, currentUserId }: { task: Task; onRefresh: () => void; currentUserId?: string }) {
  const [evaluating, setEvaluating] = useState(false)
  const [expandedEval, setExpandedEval] = useState<string | null>(null)

  const taskDone = (task.steps || []).length > 0 && (task.steps || []).every(s => s.status === 'done' || s.status === 'skipped')
  const hasEvaluations = (task.evaluations?.length || 0) > 0
  const isCreator = currentUserId === task.creator?.id

  const handleEvaluate = async () => {
    setEvaluating(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/evaluate`, { method: 'POST' })
      if (res.ok) {
        onRefresh()
      } else {
        const data = await res.json()
        alert(data.error || '评分失败')
      }
    } finally {
      setEvaluating(false)
    }
  }

  // 评分 map: memberId → evaluation
  const evalMap = new Map<string, TaskEvaluation>()
  for (const ev of task.evaluations || []) {
    evalMap.set(ev.memberId, ev)
  }

  // 收集每个 assignee 的步骤统计 + Agent 元数据
  const memberMap = new Map<string, {
    userId: string
    agentName: string
    humanName: string
    isMainAgent: boolean
    parentAgentName?: string
    parentOwnerName?: string
    agentStatus?: string  // agent.status (online/working/offline)
    stepStatus: string
    done: number
    total: number
  }>()

  for (const step of task.steps || []) {
    if (!step.assignee) continue
    const key = step.assignee.id
    const agent = step.assignee.agent
    const existing = memberMap.get(key)

    if (existing) {
      existing.total++
      if (step.status === 'done') existing.done++
      if (step.status === 'in_progress' || step.status === 'waiting_approval') {
        existing.stepStatus = step.status
      }
    } else {
      memberMap.set(key, {
        userId: step.assignee.id,
        agentName: agent?.name || '未绑定',
        humanName: step.assignee.name || '未知',
        isMainAgent: agent?.isMainAgent ?? false,
        parentAgentName: agent?.parentAgent?.name,
        parentOwnerName: agent?.parentAgent?.user?.name || undefined,
        agentStatus: agent?.status || undefined,
        stepStatus: step.status,
        done: step.status === 'done' ? 1 : 0,
        total: 1,
      })
    }
  }

  const allMembers = Array.from(memberMap.values())

  // 按归属链分组：主Agent 在前，其子Agent 缩进显示
  // 1. 找出所有主Agent
  const mainAgents = allMembers.filter(m => m.isMainAgent)
  // 2. 找出所有子Agent（有 parentAgent）
  const subAgents = allMembers.filter(m => !m.isMainAgent && m.parentAgentName)
  // 3. 无归属的（纯人类步骤或未绑定）
  const others = allMembers.filter(m => !m.isMainAgent && !m.parentAgentName)

  // 归属链状态点
  function StatusDot({ status }: { status?: string }) {
    const st = status ? agentStatusConfig[status] : null
    if (!st) return null
    return (
      <div className="flex items-center space-x-1">
        <div className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
        <span className="text-xs text-slate-400">{st.label}</span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center space-x-2">
        <span>👥</span>
        <span>任务 Team</span>
      </h3>
      {allMembers.length > 0 ? (
        <div className="space-y-2">
          {/* 主 Agent 组 */}
          {mainAgents.map((m, i) => {
            const children = subAgents.filter(s => s.parentAgentName === m.agentName)
            return (
              <div key={`main-${i}`}>
                {/* 主 Agent 行 */}
                <div className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-50 to-orange-50/50 rounded-xl">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-sm font-bold shadow-md shadow-orange-500/20">
                      {m.agentName.charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800 flex items-center space-x-1.5">
                        <span>{m.agentName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium">main</span>
                      </div>
                      <div className="text-xs text-slate-500 flex items-center space-x-1">
                        <span>→ 👤 {m.humanName}</span>
                        <StatusDot status={m.agentStatus} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 font-medium">{m.done}/{m.total}</span>
                    {evalMap.has(m.userId) && (
                      <button
                        onClick={() => setExpandedEval(expandedEval === m.userId ? null : m.userId)}
                        className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium hover:bg-amber-100"
                        title="查看评分详情"
                      >
                        ⭐{evalMap.get(m.userId)!.overallScore}
                      </button>
                    )}
                  </div>
                </div>
                {/* B12: 评分详情展开 */}
                {expandedEval === m.userId && evalMap.has(m.userId) && (
                  <EvalDetail ev={evalMap.get(m.userId)!} />
                )}
                {/* 子 Agent 行（缩进） */}
                {children.map((c, j) => (
                  <div key={`sub-${i}-${j}`}>
                    <div className="flex items-center justify-between p-2.5 pl-12 ml-4 border-l-2 border-slate-200">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white text-xs font-bold">
                          {c.agentName.charAt(0)}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                            <span>⚙️ {c.agentName}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <StatusDot status={c.agentStatus} />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-medium">{c.done}/{c.total}</span>
                        {evalMap.has(c.userId) && (
                          <button
                            onClick={() => setExpandedEval(expandedEval === c.userId ? null : c.userId)}
                            className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium hover:bg-amber-100"
                          >
                            ⭐{evalMap.get(c.userId)!.overallScore}
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedEval === c.userId && evalMap.has(c.userId) && (
                      <div className="ml-12 mb-1"><EvalDetail ev={evalMap.get(c.userId)!} /></div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
          {/* 无归属成员（纯人类步骤等） */}
          {others.map((m, i) => (
            <div key={`other-${i}`}>
              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-50 to-blue-50/30 rounded-xl">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shadow-md shadow-blue-500/20">
                    {(m.humanName || m.agentName).charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{m.agentName !== '未绑定' ? m.agentName : m.humanName}</div>
                    {m.agentName !== '未绑定' ? (
                      <div className="text-xs text-slate-500 flex items-center space-x-1">
                        <span>→ 👤 {m.humanName}</span>
                        <StatusDot status={m.agentStatus} />
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">👤 纯人类步骤</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 font-medium">{m.done}/{m.total}</span>
                  {evalMap.has(m.userId) && (
                    <button
                      onClick={() => setExpandedEval(expandedEval === m.userId ? null : m.userId)}
                      className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium hover:bg-amber-100"
                    >
                      ⭐{evalMap.get(m.userId)!.overallScore}
                    </button>
                  )}
                </div>
              </div>
              {expandedEval === m.userId && evalMap.has(m.userId) && (
                <EvalDetail ev={evalMap.get(m.userId)!} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-400 text-center py-4">暂无成员</div>
      )}

      {/* B12: 评分按钮 */}
      {taskDone && isCreator && !hasEvaluations && allMembers.length > 0 && (
        <button
          onClick={handleEvaluate}
          disabled={evaluating}
          className="mt-4 w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-semibold hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 shadow-lg shadow-amber-500/20"
        >
          {evaluating ? '⏳ AI 评分中...' : '📊 生成评分报告'}
        </button>
      )}
      {hasEvaluations && (
        <div className="mt-3 text-center text-xs text-slate-400">
          📊 已评分 · {task.evaluations?.[0]?.model || 'AI'}
        </div>
      )}
    </div>
  )
}

// B12: 评分详情卡片
function EvalDetail({ ev }: { ev: TaskEvaluation }) {
  return (
    <div className="mt-1 mb-2 p-3 bg-amber-50/50 rounded-xl border border-amber-100 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-amber-700 font-semibold">📊 {ev.memberName || '成员'} 评分</span>
        <span className="text-amber-600 font-bold text-sm">⭐ {ev.overallScore}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-1.5 bg-white rounded-lg">
          <div className="text-[10px] text-slate-500">⭐ 质量</div>
          <div className="text-sm font-bold text-slate-700">{ev.quality}</div>
        </div>
        <div className="text-center p-1.5 bg-white rounded-lg">
          <div className="text-[10px] text-slate-500">⏱️ 效率</div>
          <div className="text-sm font-bold text-slate-700">{ev.efficiency}</div>
        </div>
        <div className="text-center p-1.5 bg-white rounded-lg">
          <div className="text-[10px] text-slate-500">🤝 协作</div>
          <div className="text-sm font-bold text-slate-700">{ev.collaboration}</div>
        </div>
      </div>
      {ev.comment && (
        <div className="text-slate-600 italic">&ldquo;{ev.comment}&rdquo;</div>
      )}
      <div className="text-slate-400">{ev.stepsDone}/{ev.stepsTotal} 步骤完成</div>
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

// ============ Task Files Card (B10: Shared File Folder) ============

interface TaskFile {
  id: string; name: string; url: string; type: string | null; size: number | null
  createdAt: string; sourceTag: string
  sourceStepId?: string; sourceStepOrder?: number
  uploader: { id: string; name: string | null; isAgent: boolean; agentName?: string }
  canDelete: boolean
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
function fmtShortTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function TaskFilesCard({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<TaskFile[]>([])
  const [totalSize, setTotalSize] = useState(0)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/tasks/${taskId}/files`)
    if (r.ok) {
      const d = await r.json()
      setItems(d.files || [])
      setTotalSize(d.totalSize || 0)
    }
  }, [taskId])

  useEffect(() => { load() }, [load])

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        const form = new FormData()
        form.append('file', f)
        await fetch(`/api/tasks/${taskId}/files`, { method: 'POST', body: form })
      }
      await load()
    } finally { setUploading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('删除这个文件？')) return
    await fetch(`/api/tasks/${taskId}/files?fileId=${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          📁 任务文件{items.length > 0 && <span className="ml-1 text-slate-400">({items.length})</span>}
        </h3>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg font-medium transition disabled:opacity-50"
        >
          {uploading ? '上传中…' : '+ 上传'}
        </button>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={e => handleUpload(e.target.files)}
          accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg,.zip,.json"
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
          <p className="text-xs text-slate-400">拖拽或点击上传文件</p>
          <p className="text-xs text-slate-300 mt-0.5">PDF / Word / 图片 / JSON / ZIP · 最大 20MB</p>
        </div>
      ) : (
        <div
          className="space-y-1"
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
          onDragOver={e => e.preventDefault()}
        >
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-1.5 group px-2 py-1.5 rounded-lg hover:bg-slate-50">
              <span className="text-sm flex-shrink-0">{fileIcon(item.type)}</span>
              <a href={item.url} target="_blank" rel="noreferrer"
                className="text-xs font-medium text-slate-700 hover:text-orange-500 truncate flex-1 min-w-0 transition">
                {item.name}
              </a>
              <span className="text-[10px] text-slate-400 flex-shrink-0 whitespace-nowrap">
                {item.uploader.isAgent ? '🤖' : '👤'}{item.uploader.agentName || item.uploader.name}
              </span>
              <span className="text-[10px] text-slate-300 flex-shrink-0 whitespace-nowrap hidden sm:inline">
                {fmtShortTime(item.createdAt)}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0 whitespace-nowrap">
                {item.sourceTag}
              </span>
              {item.canDelete && (
                <button onClick={() => handleDelete(item.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition text-xs flex-shrink-0 ml-0.5">
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="pt-1.5 border-t border-slate-50 flex items-center justify-between">
            <span className="text-[10px] text-slate-300">
              共 {items.length} 个文件{totalSize > 0 && `，${fmtSize(totalSize)}`}
            </span>
            <button onClick={() => inputRef.current?.click()}
              className="text-xs text-slate-400 hover:text-orange-500 transition">
              + 添加文件
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
  const [autoParsing, setAutoParsing] = useState(false)
  const [showAddStep, setShowAddStep] = useState(false)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [newStepType, setNewStepType] = useState<'task' | 'meeting'>('task')
  const [newStepDescription, setNewStepDescription] = useState('')
  const [newStepAgenda, setNewStepAgenda] = useState('')
  const [newStepParticipants, setNewStepParticipants] = useState('')
  const [newStepScheduledAt, setNewStepScheduledAt] = useState('')
  const [newStepRequiresApproval, setNewStepRequiresApproval] = useState(true)
  const [newStepAssigneeId, setNewStepAssigneeId] = useState<string | null>(null)
  const [insertAfterOrder, setInsertAfterOrder] = useState<number | null>(null)
  const [addingStep, setAddingStep] = useState(false)

  // 协作网络成员类型
  type TeamMember = {
    type: 'human'
    id: string
    name: string
    nickname?: string
    email: string
    avatar?: string
    isSelf: boolean
    role: string
    agent: {
      id: string
      name: string
      isMainAgent: boolean
      capabilities: string[]
      status: string
      avatar?: string
    } | null
  }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])

  // 加载协作网络（替代原来的 /api/agents）
  useEffect(() => {
    fetch('/api/workspace/team')
      .then(r => r.ok ? r.json() : { members: [] })
      .then(d => setTeamMembers(d.members || []))
      .catch(() => {})
  }, [])

  const parseTask = async () => {
    if (!task.description) return alert('任务没有描述，请先填写任务描述')
    setParsing(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/parse`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        if (data.mode === 'agent') {
          // Solo 模式：主 Agent 已收到通知，等待拆解
          alert(`🤖 ${data.message}`)
        }
        onRefresh()
      } else if (res.status === 422 && data.error === 'no_main_agent') {
        // Solo 模式无主 Agent → 提示绑定
        alert(`⚡ ${data.message}`)
      } else {
        const detail = data.detail || data.error || '拆解失败'
        alert(`❌ ${detail}`)
      }
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
          description: newStepDescription || undefined,
          stepType: newStepType,
          agenda: newStepAgenda || undefined,
          participants: participants.length > 0 ? participants : undefined,
          scheduledAt: newStepScheduledAt || undefined,
          requiresApproval: newStepRequiresApproval,
          assigneeId: newStepAssigneeId?.startsWith('human:') ? newStepAssigneeId.slice(6) : (newStepAssigneeId || undefined),
          insertAfterOrder: insertAfterOrder ?? undefined,
        })
      })
      if (res.ok) {
        setNewStepTitle('')
        setNewStepType('task')
        setNewStepDescription('')
        setNewStepAgenda('')
        setNewStepParticipants('')
        setNewStepScheduledAt('')
        setNewStepRequiresApproval(true)
        setNewStepAssigneeId(null)
        setInsertAfterOrder(null)
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

  // B08: 支持多人分配 + 旧单人分配兼容
  const handleAssign = async (
    stepId: string,
    rawValue: string | null,
    multiAssign?: { assigneeIds: { userId: string; assigneeType: string }[]; completionMode?: string }
  ) => {
    let body: any
    if (multiAssign) {
      // 多人指派路径
      body = {
        assigneeIds: multiAssign.assigneeIds,
        completionMode: multiAssign.completionMode || 'all'
      }
    } else {
      // 旧单人路径
      let assigneeId = rawValue
      if (rawValue?.startsWith('human:')) {
        assigneeId = rawValue.slice(6)
      }
      body = { assigneeId }
    }
    const res = await fetch(`/api/steps/${stepId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.ok) onRefresh()
    else alert('分配失败')
  }

  const steps = task.steps?.sort((a, b) => a.order - b.order) || []
  const currentIndex = steps.findIndex(s => s.status !== 'done')
  const progress = steps.length > 0 ? Math.round((steps.filter(s => s.status === 'done').length / steps.length) * 100) : 0

  // B04: 自动检测后台 AI 拆解状态 —— team模式+有描述+0步骤+创建时间<120s → 认为正在后台拆解
  useEffect(() => {
    if (task.mode === 'team' && task.description && steps.length === 0) {
      const ageMs = Date.now() - new Date(task.createdAt).getTime()
      if (ageMs < 120_000) {
        setAutoParsing(true)
        // 超时 120s 后自动取消（防止永远卡在 loading）
        const timer = setTimeout(() => setAutoParsing(false), Math.max(120_000 - ageMs, 5000))
        return () => clearTimeout(timer)
      }
    }
    // steps 已有 → 拆解完成，清除 autoParsing
    if (steps.length > 0) setAutoParsing(false)
  }, [task.mode, task.description, task.createdAt, steps.length])

  // B04: autoParsing 期间每 5 秒轮询检查步骤是否已生成（SSE 后备方案）
  useEffect(() => {
    if (!autoParsing) return
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.steps?.length > 0) {
          console.log('[B04] 轮询检测到步骤已生成，刷新')
          setAutoParsing(false)
          onRefresh()
        }
      } catch {}
    }, 5000)
    return () => clearInterval(poll)
  }, [autoParsing, task.id, onRefresh])

  // B04: 监听 task:parsed 事件 → 立即刷新
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.taskId === task.id) {
        setAutoParsing(false)
        onRefresh()
      }
    }
    window.addEventListener('teamagent:task-parsed', handler)
    return () => window.removeEventListener('teamagent:task-parsed', handler)
  }, [task.id, onRefresh])

  // 合并两种 parsing 状态
  const isParsing = parsing || autoParsing

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center space-x-2 flex-shrink-0 whitespace-nowrap">
            <span>{getTaskTypeIcon(task).icon}</span>
            <span>工作流程</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-normal">{getTaskTypeIcon(task).label}</span>
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
          {task.description && (steps.length === 0 || isParsing) && (
            isParsing ? (
              <span className="text-xs text-orange-500 font-medium px-4 py-2 bg-orange-50 rounded-xl animate-pulse">
                🤖 AI 正在分配任务…
              </span>
            ) : (
              <button
                onClick={parseTask}
                className="text-xs bg-gradient-to-r from-orange-500 to-rose-500 text-white px-4 py-2 rounded-xl hover:from-orange-400 hover:to-rose-400 shadow-md shadow-orange-500/20 font-medium"
              >
                {task.mode === 'solo' ? '🤖 主Agent拆解' : '🤖 AI 拆解'}
              </button>
            )
          )}
          <button
            onClick={() => { setInsertAfterOrder(null); setShowAddStep(true) }}
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
          {insertAfterOrder !== null && (
            <div className="mb-2 text-xs text-orange-600 bg-orange-100 px-3 py-1.5 rounded-lg">
              ↕️ 插入到步骤 {insertAfterOrder} 之后
            </div>
          )}
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

          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={newStepTitle}
              onChange={(e) => setNewStepTitle(e.target.value)}
              placeholder={newStepType === 'meeting' ? '会议名称，如：Q2 复盘会' : '步骤标题'}
              className={`flex-1 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 bg-white ${newStepType === 'meeting' ? 'border-blue-200 focus:ring-blue-500/50' : 'border-orange-200 focus:ring-orange-500/50'}`}
              autoFocus
            />
            <VoiceMicButton onResult={(t) => setNewStepTitle(t)} size="sm" />
          </div>

          {/* 步骤说明（支持 Markdown） */}
          <div className="relative mb-2">
          <textarea
            value={newStepDescription}
            onChange={(e) => setNewStepDescription(e.target.value)}
            placeholder="步骤说明（选填，支持 Markdown）&#10;例：需要检查以下几点：&#10;- 功能是否正常&#10;- 边界情况处理"
            className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 bg-white resize-none pr-10 ${newStepType === 'meeting' ? 'border-blue-200 focus:ring-blue-500/50' : 'border-orange-200 focus:ring-orange-500/50'}`}
            rows={3}
          />
          <VoiceMicButton onResult={(t) => setNewStepDescription(prev => prev ? prev + ' ' + t : t)} append size="sm" className="absolute bottom-2 right-2" />
          </div>

          {/* 分配给协作伙伴或 Agent */}
          {newStepType === 'task' && teamMembers.length > 0 && (
            <div className="mb-2">
              <select
                value={newStepAssigneeId || ''}
                onChange={(e) => setNewStepAssigneeId(e.target.value || null)}
                className="w-full px-3 py-2 border border-orange-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 bg-white text-slate-700"
              >
                <option value="">— 不分配（稍后指派）</option>
                {teamMembers.map(m => (
                  <optgroup key={m.id} label={`👤 ${m.name || m.email}${m.isSelf ? ' (我)' : ''}`}>
                    {m.agent && (
                      <option key={m.agent.id} value={m.id}>
                        🤖 {m.agent.name}{m.agent.capabilities?.length > 0 ? ` · ${m.agent.capabilities.slice(0, 2).join(', ')}` : ''}
                      </option>
                    )}
                    <option key={`human-${m.id}`} value={`human:${m.id}`}>
                      👤 指派给{m.isSelf ? '自己' : m.name || m.email}（人工执行）
                    </option>
                  </optgroup>
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
              <div key={step.id}>
                <StepCard
                  step={step}
                  index={index}
                  isActive={index === currentIndex}
                  canApprove={(step as any).viewerCanApprove ?? (canApprove || currentUserId === step.assignee?.id)}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  agents={teamMembers}
                  onAssign={handleAssign}
                  currentUserId={currentUserId}
                  onRefresh={onRefresh}
                  taskCreatorName={task.creator?.name || task.creator?.email}
                />
                {/* 步骤间插入按钮：桌面 hover 显示，移动端常显 */}
                {canApprove && (
                  <div className="flex items-center justify-center py-1 group">
                    <button
                      onClick={() => { setInsertAfterOrder(step.order); setShowAddStep(true) }}
                      className="opacity-30 sm:opacity-0 group-hover:opacity-100 active:opacity-100 text-xs text-slate-400 hover:text-orange-500 active:text-orange-500 px-3 py-1 rounded-full border border-dashed border-slate-300 hover:border-orange-300 active:border-orange-300 bg-white transition-all"
                    >
                      + 插入
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            {isParsing ? (
              <div className="flex flex-col items-center">
                {/* 动态圆环动画 */}
                <div className="relative w-20 h-20 mb-4">
                  <div className="absolute inset-0 rounded-full border-4 border-orange-100" />
                  <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-orange-500 animate-spin" />
                  <div className="absolute inset-2 rounded-full border-4 border-transparent border-b-rose-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                  <div className="absolute inset-0 flex items-center justify-center text-2xl">🤖</div>
                </div>
                <div className="text-sm font-semibold text-orange-600 mb-1">AI 正在分析任务并分配步骤</div>
                <div className="text-xs text-slate-400 mb-3">正在为每位成员智能匹配最合适的任务…</div>
                <div className="flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            ) : (
              <>
                <div className="text-5xl mb-3">📝</div>
                <div className="text-sm font-medium">暂无步骤</div>
                <div className="text-xs mt-1">点击&quot;AI 拆解&quot;或&quot;添加步骤&quot;开始</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type TeamMemberProp = {
  type: 'human'
  id: string
  name: string
  nickname?: string
  email: string
  avatar?: string
  isSelf: boolean
  role: string
  agent: {
    id: string
    name: string
    isMainAgent: boolean
    capabilities: string[]
    status: string
    avatar?: string
  } | null
}

function StepCard({
  step, index, isActive, canApprove, onApprove, onReject, agents, onAssign, currentUserId, onRefresh, taskCreatorName
}: {
  step: TaskStep; index: number; isActive: boolean; canApprove: boolean
  onApprove: (id: string) => Promise<void>; onReject: (id: string, reason: string) => Promise<void>
  agents?: TeamMemberProp[]
  onAssign?: (stepId: string, userId: string | null, multiAssign?: { assigneeIds: { userId: string; assigneeType: string }[]; completionMode?: string }) => Promise<void>
  currentUserId?: string
  onRefresh?: () => void
  taskCreatorName?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<Submission[]>([])
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [assigneeSelect, setAssigneeSelect] = useState<string>(step.assignee?.id || '')
  const [savingAssignee, setSavingAssignee] = useState(false)
  // B08: 多选状态
  const [multiSelected, setMultiSelected] = useState<Map<string, 'agent' | 'human'>>(new Map())
  const [completionMode, setCompletionMode] = useState<'all' | 'any'>((step.completionMode as 'all' | 'any') || 'all')
  const assignDropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; openUp: boolean }>({ top: 0, left: 0, openUp: false })
  const [humanCompleting, setHumanCompleting] = useState(false)
  // 申诉相关状态
  const [showAppealForm, setShowAppealForm] = useState(false)
  const [appealText, setAppealText] = useState('')
  const [appealSubmitting, setAppealSubmitting] = useState(false)
  const [resolveSubmitting, setResolveSubmitting] = useState(false)
  // 评论相关状态
  const [comments, setComments] = useState<Array<{
    id: string; content: string; createdAt: string
    author: { id: string; name: string | null; email: string; avatar: string | null }
    attachments: { id: string; name: string; url: string; type: string | null; size: number | null }[]
  }>>([])
  const [commentText, setCommentText] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  // B10: 步骤文件
  const [stepFiles, setStepFiles] = useState<TaskFile[]>([])
  const [stepFilesLoaded, setStepFilesLoaded] = useState(false)
  // F02: @mention 自动补全状态
  const [mentionQuery, setMentionQuery] = useState<string | null>(null) // null = 隐藏
  const [mentionIdx, setMentionIdx] = useState(0)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const mentionStartPos = useRef<number>(0)

  const isMeeting = step.stepType === 'meeting'
  const status = statusConfig[step.status] || statusConfig.pending
  const isWaiting = step.status === 'waiting_approval'
  const hasAgent = !!step.assignee?.agent
  // B08: 多人指派显示
  const multiAssignees = step.assignees || []
  const hasMultiAssignees = multiAssignees.length > 1
  const assigneeName = hasMultiAssignees
    ? multiAssignees.map(a => a.user?.agent ? `🤖${a.user.agent.name}` : `👤${a.user?.name || '?'}`).join(' ')
    : hasAgent
      ? step.assignee!.agent!.name
      : (step.assignee?.name || step.assignee?.email || parseJSON(step.assigneeNames)[0] || '未分配')
  // B08: 是否纯人类步骤（无 agent 的 assignee）
  const isHumanStep = multiAssignees.length > 0
    ? multiAssignees.every(a => a.assigneeType === 'human')
    : !hasAgent && !!step.assignee
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

  const loadComments = async () => {
    try {
      const res = await fetch(`/api/steps/${step.id}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(data.comments || [])
        setCommentsLoaded(true)
      }
    } catch (e) {
      console.error(e)
    }
  }

  // B10: 加载步骤文件
  const loadStepFiles = async () => {
    try {
      const res = await fetch(`/api/steps/${step.id}/files`)
      if (res.ok) {
        const data = await res.json()
        setStepFiles(data.files || [])
        setStepFilesLoaded(true)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const sendComment = async () => {
    if (!commentText.trim() || commentSending) return
    setCommentSending(true)
    try {
      const res = await fetch(`/api/steps/${step.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText.trim() })
      })
      if (res.ok) {
        const data = await res.json()
        setComments(prev => [...prev, data.comment])
        setCommentText('')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCommentSending(false)
    }
  }

  const handleExpand = () => {
    const next = !expanded
    setExpanded(next)
    if (next && history.length === 0) loadHistory()
    if (next && !commentsLoaded) loadComments()
    if (next && !stepFilesLoaded) loadStepFiles()
  }

  const saveAssignee = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onAssign) return
    setSavingAssignee(true)
    try {
      if (multiSelected.size > 0) {
        // B08: 多人指派 — 将 human:xxx 格式转为实际 userId
        const assigneeIds = Array.from(multiSelected.entries()).map(([key, assigneeType]) => ({
          userId: key.startsWith('human:') ? key.slice(6) : key,
          assigneeType
        }))
        await onAssign(step.id, null, { assigneeIds, completionMode })
      } else {
        // 旧单人路径
        await onAssign(step.id, assigneeSelect || null)
      }
      setEditingAssignee(false)
    } finally {
      setSavingAssignee(false)
    }
  }

  // B08: 多选切换 — 同一真实用户只保留一种身份（agent / human 互斥）
  const toggleMultiSelect = (userId: string, type: 'agent' | 'human') => {
    setMultiSelected(prev => {
      const next = new Map(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        // 提取真实 userId（去掉 human: 前缀）
        const realId = userId.startsWith('human:') ? userId.slice(6) : userId
        // 互斥：如果选了 agent，删除同一用户的 human 条目，反之亦然
        const counterpart = type === 'agent' ? `human:${realId}` : realId
        next.delete(counterpart)
        next.set(userId, type)
      }
      return next
    })
  }

  // 点击外部关闭分配弹窗（自动保存）— Portal 版本需同时排除触发按钮
  useEffect(() => {
    if (!editingAssignee) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // 忽略点击触发按钮（由 onClick toggle 处理）
      if (target.closest('[data-assign-trigger]')) return
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(target)) {
        // 有选中 → 自动保存；无选中 → 直接关闭
        if (multiSelected.size > 0 && onAssign && !savingAssignee) {
          const assigneeIds = Array.from(multiSelected.entries()).map(([key, assigneeType]) => ({
            userId: key.startsWith('human:') ? key.slice(6) : key,
            assigneeType
          }))
          setSavingAssignee(true)
          onAssign(step.id, null, { assigneeIds, completionMode })
            .then(() => { setEditingAssignee(false) })
            .finally(() => { setSavingAssignee(false) })
        } else {
          setEditingAssignee(false)
          setMultiSelected(new Map())
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingAssignee, multiSelected, savingAssignee, onAssign, step.id, completionMode])

  // B08: 人类手动完成
  const handleHumanComplete = async () => {
    setHumanCompleting(true)
    try {
      const res = await fetch(`/api/steps/${step.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: '✅ 人工确认完成', summary: '手动完成' })
      })
      if (res.ok) onRefresh?.()
      else {
        const data = await res.json()
        alert(data.error || '提交失败')
      }
    } finally {
      setHumanCompleting(false)
    }
  }

  // F02: @mention 候选人列表（从 agents prop 构建）
  const mentionCandidates = (agents || []).flatMap(m => {
    const items: { userId: string; displayName: string; icon: string }[] = []
    // 人类成员
    items.push({
      userId: m.id,
      displayName: m.nickname || m.name,
      icon: '👤'
    })
    // Agent 成员
    if (m.agent) {
      items.push({
        userId: m.id, // Agent 的 userId 就是 member 的 id
        displayName: m.agent.name,
        icon: '🤖'
      })
    }
    return items
  })
  // 去重（Agent 和人类可能指向同一 userId）
  const mentionMap = new Map<string, { userId: string; displayName: string; icon: string }>()
  for (const c of mentionCandidates) {
    if (!mentionMap.has(`${c.userId}-${c.displayName}`)) {
      mentionMap.set(`${c.userId}-${c.displayName}`, c)
    }
  }
  const allMentionItems = Array.from(mentionMap.values())

  const filteredMentions = mentionQuery !== null
    ? allMentionItems.filter(c =>
        c.displayName.toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 6)
    : []

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setCommentText(val)

    // 检测 @ 触发
    const pos = e.target.selectionStart || 0
    const textBeforeCursor = val.substring(0, pos)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (atMatch) {
      mentionStartPos.current = pos - atMatch[0].length
      setMentionQuery(atMatch[1])
      setMentionIdx(0)
    } else {
      setMentionQuery(null)
    }
  }

  const insertMention = (candidate: { userId: string; displayName: string }) => {
    const before = commentText.substring(0, mentionStartPos.current)
    const after = commentText.substring(
      mentionStartPos.current + (mentionQuery?.length || 0) + 1 // +1 for @
    )
    // 插入格式: @[显示名](userId) 后面加空格
    const mention = `@[${candidate.displayName}](${candidate.userId}) `
    setCommentText(before + mention + after)
    setMentionQuery(null)
    // 恢复焦点
    setTimeout(() => {
      const ta = commentRef.current
      if (ta) {
        ta.focus()
        const newPos = before.length + mention.length
        ta.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx(i => Math.min(i + 1, filteredMentions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredMentions[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    // 默认: Enter 发送评论
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendComment()
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

  // B08: 扩展 isStepAssignee 包含多人指派
  const isStepAssignee = currentUserId && (
    step.assignee?.id === currentUserId ||
    multiAssignees.some(a => a.userId === currentUserId)
  )
  const isRejected = step.status === 'pending' && step.rejectedAt

  return (
    <div className={`rounded-2xl border-2 transition-all ${
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
                <>
                <span className="flex items-center space-x-1 flex-wrap">
                  {hasMultiAssignees ? (
                    <>
                      {multiAssignees.slice(0, 3).map(a => (
                        <span key={a.userId} className="inline-flex items-center gap-0.5 text-xs">
                          {a.user?.agent ? '🤖' : '👤'}
                          <span>{a.user?.agent?.name || a.user?.name || '?'}</span>
                        </span>
                      ))}
                      {multiAssignees.length > 3 && <span className="text-xs text-slate-400">+{multiAssignees.length - 3}</span>}
                      {step.completionMode === 'any' && <span className="text-xs text-blue-500 bg-blue-50 px-1 rounded">任一</span>}
                    </>
                  ) : (
                    <span>{hasAgent ? '🤖' : '👤'} {assigneeName}</span>
                  )}
                  {agents && agents.length > 0 && (
                    <button
                      data-assign-trigger
                      onClick={(e) => {
                        e.stopPropagation()
                        // 点击时如果已打开 → 关闭（toggle 行为）
                        if (editingAssignee) {
                          setEditingAssignee(false)
                          setMultiSelected(new Map())
                          return
                        }
                        // 计算按钮位置，Portal 浮层将基于此定位
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const spaceBelow = window.innerHeight - rect.bottom
                        const openUp = spaceBelow < 300 && rect.top > spaceBelow
                        setDropdownPos({
                          top: openUp ? rect.top : rect.bottom + 4,
                          left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
                          openUp
                        })
                        // B08: 初始化多选状态（从现有 assignees 读取）
                        const initial = new Map<string, 'agent' | 'human'>()
                        if (multiAssignees.length > 0) {
                          for (const a of multiAssignees) {
                            if (a.assigneeType === 'human') initial.set(`human:${a.userId}`, 'human')
                            else initial.set(a.userId, 'agent')
                          }
                        } else if (step.assignee?.id) {
                          initial.set(hasAgent ? step.assignee.id : `human:${step.assignee.id}`, hasAgent ? 'agent' : 'human')
                        }
                        setMultiSelected(initial)
                        setEditingAssignee(true)
                      }}
                      className={`px-1.5 py-0.5 rounded text-xs border ml-1 ${editingAssignee ? 'bg-blue-100 text-blue-600 border-blue-300' : 'bg-blue-50 text-blue-500 hover:bg-blue-100 border-blue-200'}`}
                    >
                      {editingAssignee ? '选择中…' : '分配'}
                    </button>
                  )}
                </span>
                {/* B08: 多选 checkbox 面板 — Portal 渲染避免 overflow 裁剪 */}
                {editingAssignee && typeof document !== 'undefined' && createPortal(
                  <div
                    ref={assignDropdownRef}
                    onClick={e => e.stopPropagation()}
                    className="fixed z-[9999] bg-white border border-blue-200 rounded-xl shadow-2xl min-w-[220px] flex flex-col"
                    style={{
                      ...(dropdownPos.openUp
                        ? { bottom: `${window.innerHeight - dropdownPos.top + 4}px`, left: `${dropdownPos.left}px` }
                        : { top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px` }),
                      maxHeight: '50vh'
                    }}
                  >
                    <div className="px-3 pt-3 pb-1">
                      <div className="text-xs text-slate-500 font-medium mb-1">选择负责人（可多选）</div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-3" style={{ maxHeight: '160px' }}>
                    {(agents || []).map(m => (
                      <div key={m.id} className="mb-2">
                        <div className="text-xs text-slate-400 mb-1">👤 {m.name || m.email}{m.isSelf ? ' (我)' : ''}</div>
                        {m.agent && (
                          <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-blue-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={multiSelected.has(m.id)}
                              onChange={() => toggleMultiSelect(m.id, 'agent')}
                              className="rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                            />
                            <span className="text-xs">🤖 {m.agent.name}</span>
                            <span className={`w-1.5 h-1.5 rounded-full ${m.agent.status === 'online' ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                          </label>
                        )}
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-blue-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={multiSelected.has(`human:${m.id}`)}
                            onChange={() => toggleMultiSelect(`human:${m.id}`, 'human')}
                            className="rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                          />
                          <span className="text-xs">👤 {m.isSelf ? '自己' : m.name || m.email}</span>
                        </label>
                      </div>
                    ))}
                    </div>
                    <div className="px-3 pb-3 border-t border-slate-100">
                    {multiSelected.size > 1 && (
                      <div className="pt-2 pb-1">
                        <div className="text-xs text-slate-500 mb-1">完成模式</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setCompletionMode('all')}
                            className={`text-xs px-2 py-1 rounded-lg border ${completionMode === 'all' ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-slate-200 text-slate-500'}`}
                          >全部完成</button>
                          <button
                            onClick={() => setCompletionMode('any')}
                            className={`text-xs px-2 py-1 rounded-lg border ${completionMode === 'any' ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-slate-200 text-slate-500'}`}
                          >任一完成</button>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={saveAssignee}
                        disabled={savingAssignee || multiSelected.size === 0}
                        className="flex-1 text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                      >
                        {savingAssignee ? '...' : `确认 (${multiSelected.size})`}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingAssignee(false); setMultiSelected(new Map()) }}
                        className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                      >
                        取消
                      </button>
                    </div>
                    </div>
                  </div>,
                  document.body
                )}
                </>
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

          {step.description && (
            <div className="text-sm text-slate-600 mt-4 p-3 bg-slate-50 rounded-xl prose prose-sm max-w-none prose-slate">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.description}</ReactMarkdown>
            </div>
          )}

          {/* B08: 多人提交进度 */}
          {hasMultiAssignees && step.status !== 'pending' && (
            <div className="mt-4 p-3 bg-slate-50 rounded-xl">
              <div className="text-xs text-slate-500 font-medium mb-2">
                📊 提交进度 ({multiAssignees.filter(a => a.status === 'submitted' || a.status === 'done').length}/{multiAssignees.length})
                {step.completionMode === 'any' && <span className="ml-1 text-blue-500">(任一完成即可)</span>}
              </div>
              <div className="space-y-1">
                {multiAssignees.map(a => (
                  <div key={a.userId} className="flex items-center gap-2 text-xs">
                    <span className={`w-4 text-center ${a.status === 'submitted' || a.status === 'done' ? 'text-emerald-500' : 'text-slate-400'}`}>
                      {a.status === 'submitted' || a.status === 'done' ? '✅' : '⏳'}
                    </span>
                    <span>{a.user?.agent ? '🤖' : '👤'}</span>
                    <span className="text-slate-700">{a.user?.agent?.name || a.user?.name || '?'}</span>
                    <span className="text-slate-400">— {a.status === 'done' ? '已完成' : a.status === 'submitted' ? '已提交' : a.status === 'in_progress' ? '进行中' : '待提交'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* B08: 纯人类步骤 - 手动完成按钮 */}
          {isHumanStep && isStepAssignee && step.status === 'in_progress' && (
            <div className="mt-4">
              <button
                onClick={handleHumanComplete}
                disabled={humanCompleting}
                className="w-full px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl text-sm font-semibold hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 shadow-lg shadow-emerald-500/20"
              >
                {humanCompleting ? '⏳ 提交中...' : '✅ 手动完成'}
              </button>
            </div>
          )}

          {step.result && (
            <div className={`mt-4 p-4 rounded-xl ${isMeeting ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50'}`}>
              <div className="text-xs text-slate-500 mb-2 font-medium">
                {isMeeting ? '📝 会议纪要' : '📝 提交结果'}
              </div>
              <div className="text-sm text-slate-700 prose prose-sm max-w-none prose-slate">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.result}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* 时间线 */}
          {(step.completedAt || step.approvedAt || step.rejectedAt) && (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              {step.completedAt && (
                <span>📤 提交 {new Date(step.completedAt).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
              )}
              {step.approvedAt && (
                <span className="text-emerald-600">
                  ✅ 通过{step.approvedByUser ? ` · ${step.approvedByUser.name || step.approvedByUser.email}` : ''}{' '}
                  {new Date(step.approvedAt).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                </span>
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

          {/* 📎 B10: 步骤文件 */}
          {stepFiles.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1.5 font-medium">📎 步骤文件 ({stepFiles.length})</div>
              <div className="space-y-0.5">
                {stepFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-50 group">
                    <span className="text-sm flex-shrink-0">{fileIcon(f.type)}</span>
                    <a href={f.url} target="_blank" rel="noreferrer"
                      className="text-xs text-slate-700 hover:text-orange-500 truncate flex-1 min-w-0 transition">
                      {f.name}
                    </a>
                    <span className="text-[10px] text-slate-400 flex-shrink-0 whitespace-nowrap">
                      {f.uploader.isAgent ? '🤖' : '👤'}{f.uploader.agentName || f.uploader.name}
                    </span>
                    <span className="text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">
                      {f.sourceTag}
                    </span>
                    <span className="text-[10px] text-slate-300 flex-shrink-0">{fmtSize(f.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 💬 评论区 */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-2 font-medium">💬 讨论 {comments.length > 0 ? `(${comments.length})` : ''}</div>

            {/* 评论列表 */}
            {comments.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto mb-3">
                {comments.map(c => {
                  const isMe = c.author.id === currentUserId
                  return (
                    <div key={c.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] ${isMe ? 'order-2' : ''}`}>
                        <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${isMe ? 'bg-orange-500' : 'bg-indigo-500'}`}>
                            {(c.author.name || c.author.email).charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[10px] text-slate-400">{c.author.name || c.author.email.split('@')[0]}</span>
                          <span className="text-[10px] text-slate-300">
                            {new Date(c.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`px-3 py-2 rounded-xl text-sm ${
                          isMe
                            ? 'bg-orange-50 text-orange-900 rounded-tr-md'
                            : 'bg-slate-50 text-slate-700 rounded-tl-md'
                        }`}>
                          <p className="whitespace-pre-wrap break-words">{
                            /* F02: 渲染 @mention 为高亮标签 */
                            c.content.split(/(@\[[^\]]+\]\([^)]+\))/).map((part, pi) => {
                              const m = part.match(/^@\[([^\]]+)\]\(([^)]+)\)$/)
                              if (m) return <span key={pi} className="text-orange-600 font-medium bg-orange-100/60 rounded px-0.5">@{m[1]}</span>
                              return <span key={pi}>{part}</span>
                            })
                          }</p>
                          {c.attachments.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {c.attachments.map(att => (
                                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                  📎 {att.name}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 评论输入框 + F02 @mention */}
            <div className="relative">
              {/* F02: @mention 下拉列表 */}
              {mentionQuery !== null && filteredMentions.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20">
                  {filteredMentions.map((c, i) => (
                    <button
                      key={`${c.userId}-${c.displayName}`}
                      onClick={() => insertMention(c)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-orange-50 transition-colors ${
                        i === mentionIdx ? 'bg-orange-50 text-orange-700' : 'text-slate-700'
                      }`}
                    >
                      <span>{c.icon}</span>
                      <span className="font-medium">{c.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={commentRef}
                  value={commentText}
                  onChange={handleCommentChange}
                  onKeyDown={handleCommentKeyDown}
                  placeholder="说点什么... 输入 @ 提及成员"
                  rows={1}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 bg-white placeholder:text-slate-400"
                  style={{ minHeight: '36px', maxHeight: '80px' }}
                />
                <button
                  onClick={sendComment}
                  disabled={!commentText.trim() || commentSending}
                  className="w-8 h-8 bg-orange-500 hover:bg-orange-400 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-full flex items-center justify-center transition-colors flex-shrink-0 text-sm"
                >
                  {commentSending ? '⏳' : '↑'}
                </button>
              </div>
            </div>
          </div>

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

          {isWaiting && !canApprove && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-4 py-2.5 rounded-xl">
                <span>⏳</span>
                <span>等待审批中</span>
              </div>
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
          <div className="text-slate-700 text-xs bg-slate-50 p-3 rounded-lg prose prose-sm max-w-none prose-slate">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{submission.result}</ReactMarkdown>
          </div>
          {submission.reviewNote && (
            <div className={`mt-2 p-3 rounded-lg text-xs ${
              submission.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              <span className="font-medium">{submission.reviewedBy?.name}:</span> {submission.reviewNote}
            </div>
          )}
          {/* B10: 提交附件 */}
          {submission.attachments && submission.attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {submission.attachments.map(att => (
                <a key={att.id} href={att.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline transition">
                  <span>{fileIcon(att.type || null)}</span>
                  <span className="truncate">{att.name}</span>
                </a>
              ))}
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg p-5 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入任务名称..."
                className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500/50 focus:border-orange-400"
                autoFocus
              />
              <VoiceMicButton onResult={(t) => setTitle(t)} />
            </div>
          </div>
          
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">任务描述</label>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="详细描述任务内容，AI 将根据此内容自动拆解步骤..."
                className="w-full px-4 py-3 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-400 pr-12"
                rows={4}
              />
              <VoiceMicButton onResult={(t) => setDescription(prev => prev ? prev + ' ' + t : t)} append className="absolute bottom-3 right-3" />
            </div>
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
            `## 第一步：在 TeamAgent 注册成员账号\n` +
            `1. 根据工作类型，为每位成员设计专属职责和个性名字（带 emoji），并为每位成员确定一个简短英文小写的 agentId（如 galileo、compass）\n` +
            `2. 用下面的 API 逐一注册成员账号\n\n` +
            `POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/agents/register\n` +
            `Authorization: Bearer <你的 TeamAgent token>\n` +
            `Content-Type: application/json\n\n` +
            `{\n` +
            `  "name": "🦑 成员名字",\n` +
            `  "email": "agentId@${companyName.toLowerCase().replace(/\s+/g, '')}.ai",\n` +
            `  "password": "lobster-agent-2026",\n` +
            `  "capabilities": ["能力1","能力2"],\n` +
            `  "personality": "一句话个性描述"\n` +
            `}\n\n` +
            `## 第二步：在 OpenClaw 创建真正的子 Agent（必须做！）\n` +
            `TeamAgent 注册只是建账号，子 Agent 必须在 OpenClaw 中创建才能真正执行任务。\n\n` +
            `对每位成员：\n` +
            `a. 创建 workspace 和 agentDir 目录（用 exec 工具）：\n` +
            `   New-Item -ItemType Directory -Force -Path "~\\.openclaw\\workspace-<agentId>"\n` +
            `   New-Item -ItemType Directory -Force -Path "~\\.openclaw\\agents\\<agentId>\\agent"\n\n` +
            `b. 用 gateway config.patch 工具将所有新成员加入 agents.list，并把他们的 agentId 加入 main.subagents.allowAgents：\n` +
            `   { "agents": { "list": [ { "id": "main", "subagents": { "allowAgents": [...原有成员, "<agentId>"] } }, ...原有成员配置, { "id": "<agentId>", "name": "<全名>", "workspace": "C:\\\\Users\\\\<你的用户名>\\\\.openclaw\\\\workspace-<agentId>", "agentDir": "C:\\\\Users\\\\<你的用户名>\\\\.openclaw\\\\agents\\\\<agentId>\\\\agent" } ] } }\n\n` +
            `## 第三步：提交成员名单供审批\n` +
            `提交内容：成员名单表格（名字 / 邮箱 / agentId / 职责 / OpenClaw ✅）`,
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
        <div className="mt-3 space-y-3">
          {/* /ta-register 命令 */}
          <div className="flex items-center gap-2 bg-slate-800 rounded-xl px-4 py-2.5 w-fit max-w-full">
            <span className="text-emerald-400 font-mono text-sm">/ta-register</span>
            <button
              onClick={() => {
                const text = '/ta-register'
                if (navigator.clipboard && window.isSecureContext) {
                  navigator.clipboard.writeText(text).catch(() => {
                    const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'; document.body.appendChild(el); el.focus(); el.select(); document.execCommand('copy'); document.body.removeChild(el)
                  })
                } else {
                  const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'; document.body.appendChild(el); el.focus(); el.select(); document.execCommand('copy'); document.body.removeChild(el)
                }
              }}
              className="text-xs px-2 py-1 bg-slate-600 hover:bg-slate-500 text-slate-300 rounded-lg transition font-mono"
              title="复制命令">
              📋 复制
            </button>
            <span className="text-slate-400 text-xs">← 在 OpenClaw 里运行</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={onPairAgent} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold hover:from-orange-400 hover:to-rose-400 shadow-md shadow-orange-500/20">⊕ 输入配对码</button>
            <button type="button" onClick={() => window.location.href = '/build-agent'}
              className="text-xs text-slate-400 hover:text-orange-500 transition flex items-center gap-1 underline underline-offset-2">
              📖 查看安装指引 →
            </button>
          </div>
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
    <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50/20 px-4 sm:px-8 py-6 sm:py-8 overflow-y-auto">
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

// ============ Mobile Profile Tab ============

interface MobileAgent {
  id: string; name: string; personality: string | null; avatar: string | null
  status: string; capabilities: string | null; isMainAgent: boolean
  stats: { doneSteps: number; pendingSteps: number }
}

const mobileStatusDot: Record<string, string> = {
  online: 'bg-emerald-400', working: 'bg-blue-400', waiting: 'bg-yellow-400', offline: 'bg-slate-500'
}
const mobileStatusLabel: Record<string, string> = {
  online: '在线', working: '工作中', waiting: '待命', offline: '离线'
}
const mobileGradients = [
  'from-orange-400 to-rose-500','from-blue-400 to-purple-500',
  'from-green-400 to-teal-500','from-yellow-400 to-orange-500',
  'from-pink-400 to-rose-500','from-indigo-400 to-blue-500',
]

function MobileProfileView({ userEmail, userName, onSignOut }: {
  userEmail: string; userName: string; onSignOut: () => void
}) {
  const initials = (userName || userEmail || '?').charAt(0).toUpperCase()
  const [agents, setAgents] = useState<MobileAgent[]>([])
  const [mainAgent, setMainAgent] = useState<MobileAgent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/agents/team')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setMainAgent(d.mainAgent || null)
          setAgents(d.subAgents || [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const allAgents = mainAgent ? [mainAgent, ...agents] : agents
  const onlineCount = allAgents.filter(a => a.status !== 'offline').length

  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 to-slate-800">
      {/* 司令官头部 */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-xl font-bold text-white shadow-lg shadow-orange-500/30 flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white truncate">{userName || '用户'}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-medium">👑 总司令</span>
            </div>
            <p className="text-slate-500 text-xs truncate">{userEmail}</p>
          </div>
          <a href="/settings" className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center text-slate-400 active:bg-slate-700 flex-shrink-0">
            <span className="text-sm">⚙️</span>
          </a>
        </div>
      </div>

      {/* 军团列表 */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🌊</span>
            <span className="text-white font-bold text-sm">我的军团</span>
            <span className="text-slate-500 text-xs">{allAgents.length} 位 · {onlineCount} 在线</span>
          </div>
          <a href="/workspace" className="text-orange-400 text-xs font-medium active:text-orange-300">详情 ›</a>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="text-2xl animate-bounce">🌊</div>
            <p className="text-slate-500 text-xs mt-2">加载军团...</p>
          </div>
        ) : allAgents.length === 0 ? (
          <div className="text-center py-8 bg-slate-800/40 rounded-2xl border border-slate-700/50">
            <div className="text-3xl mb-2">🤖</div>
            <p className="text-slate-400 text-sm">还没有 Agent 成员</p>
            <a href="/build-agent" className="inline-block mt-3 px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-xs font-semibold">
              配对第一位 Agent
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            {allAgents.map((agent) => {
              const grad = mobileGradients[agent.name.charCodeAt(0) % mobileGradients.length]
              const dot = mobileStatusDot[agent.status] || mobileStatusDot.offline
              const label = mobileStatusLabel[agent.status] || '离线'
              const caps = (() => { try { const p = JSON.parse(agent.capabilities || '[]'); return Array.isArray(p) ? p.slice(0, 2) : [] } catch { return [] } })()
              const total = agent.stats.doneSteps + agent.stats.pendingSteps
              const pct = total > 0 ? Math.round((agent.stats.doneSteps / total) * 100) : 0
              // 提取 emoji 头像：优先用 avatar 字段，其次从 name 开头提取 emoji，主 Agent 默认 🦞
              const emojiMatch = agent.name.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u)
              const avatarIcon = agent.avatar?.trim() || (emojiMatch ? emojiMatch[0] : (agent.isMainAgent ? '🦞' : agent.name.charAt(0)))

              return (
                <a key={agent.id} href={`/agent/${agent.id}`}
                  className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors ${
                    agent.isMainAgent
                      ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/10 border border-orange-400/30 active:from-orange-500/30'
                      : 'bg-slate-800/60 border border-slate-700/50 active:bg-slate-700/60'
                  }`}>
                  <div className="relative flex-shrink-0">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${agent.isMainAgent ? 'from-orange-400 to-rose-500' : grad} flex items-center justify-center text-lg shadow-sm`}>
                      {avatarIcon}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-800 ${dot}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white text-sm font-semibold truncate">{agent.name}</span>
                      {agent.isMainAgent && <span className="text-[10px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-300 font-medium flex-shrink-0">主</span>}
                      <span className={`text-[10px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${agent.status !== 'offline' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>{label}</span>
                    </div>
                    {caps.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {caps.map(c => <span key={c} className="text-[10px] text-slate-500">{c}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 w-12 text-right">
                    <div className="text-xs font-semibold text-emerald-400">{agent.stats.doneSteps}</div>
                    <div className="w-full h-1 bg-slate-700 rounded-full mt-0.5 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-orange-400 to-emerald-400 rounded-full" style={{ width: `${Math.max(pct, pct > 0 ? 10 : 0)}%` }} />
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部快捷操作 + 退出 */}
      <div className="px-4 pt-2 pb-8 space-y-2">
        <div className="flex gap-2">
          <a href="/workspace" className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800/60 border border-slate-700/50 rounded-xl py-2.5 text-slate-300 active:bg-slate-700/60 text-xs font-medium">
            <span>🏠</span><span>我的工作区</span>
          </a>
          <a href="/landing" className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800/60 border border-slate-700/50 rounded-xl py-2.5 text-slate-300 active:bg-slate-700/60 text-xs font-medium">
            <span>🌐</span><span>官网首页</span>
          </a>
        </div>
        <button
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl py-2.5 active:bg-red-500/20 transition-colors"
        >
          <span className="text-sm">🚪</span>
          <span className="text-xs font-semibold text-red-400">退出登录</span>
        </button>
      </div>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50/30 px-4">
      <div className="text-5xl sm:text-7xl mb-4 sm:mb-6">🦞</div>
      <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-2 text-center">欢迎使用 TeamAgent</h2>
      <p className="text-slate-500 mb-6 sm:mb-8 text-sm text-center">AI 与人类协作的任务管理平台</p>
      <button
        onClick={onCreate}
        className="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-2xl hover:from-orange-400 hover:to-rose-400 font-semibold shadow-xl shadow-orange-500/30 text-base sm:text-lg"
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [myAgent, setMyAgent] = useState<{ name: string; status: string } | null>(null)
  const [agentChecked, setAgentChecked] = useState(false)
  const [showPairingModal, setShowPairingModal] = useState(false)

  // ── 移动端 chat-first 状态 ──────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false)
  const [activeTab, setActiveTab] = useState<'chat' | 'tasks' | 'profile'>(() => {
    if (typeof window === 'undefined') return 'chat'
    const t = new URLSearchParams(window.location.search).get('t')
    return t === 'tasks' ? 'tasks' : t === 'profile' ? 'profile' : 'chat'
  })
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatReloading, setChatReloading] = useState(false)
  const [pendingMsgId, setPendingMsgId] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 未登录由下方 LandingPage 处理，不再强制跳转

  // ── 移动端检测 + 聊天历史加载 ──────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── URL ?t= 参数 + 底导航事件同步 activeTab（移动端） ─────────────
  useEffect(() => {
    if (!isMobile) return

    const syncFromUrl = () => {
      const t = new URLSearchParams(window.location.search).get('t')
      if (t === 'tasks') setActiveTab('tasks')
      else if (t === 'profile') setActiveTab('profile')
      else setActiveTab('chat')
    }

    syncFromUrl()

    const handler = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: 'chat' | 'tasks' | 'profile' }>).detail?.tab
      if (tab) setActiveTab(tab)
    }

    window.addEventListener('mobileTabChange', handler)
    window.addEventListener('popstate', syncFromUrl)
    return () => {
      window.removeEventListener('mobileTabChange', handler)
      window.removeEventListener('popstate', syncFromUrl)
    }
  }, [isMobile])

  const loadChatHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/history?limit=50')
      if (res.ok) {
        const data = await res.json()
        // __pending__ 消息由 history API 转换为 '...'，ChatBubble 会显示为 typing 动画
        setChatMessages(data.messages || [])
      }
    } catch (e) {
      console.error('加载聊天历史失败:', e)
    }
  }, [])

  useEffect(() => {
    if (session) loadChatHistory()
  }, [session, loadChatHistory])

  const reloadChatHistory = useCallback(async () => {
    try {
      setChatReloading(true)
      await loadChatHistory()
    } finally {
      setChatReloading(false)
    }
  }, [loadChatHistory])

  // 聊天页兜底刷新：即使实时轮询超时，也会定期拉取最新消息
  useEffect(() => {
    if (!session || !isMobile || activeTab !== 'chat') return
    const timer = setInterval(() => {
      loadChatHistory().catch(() => {})
    }, 15000)
    return () => clearInterval(timer)
  }, [session, isMobile, activeTab, loadChatHistory])

  // 对话页始终自动滚动到底部，确保进入即看到最新消息
  useEffect(() => {
    if (!isMobile || activeTab !== 'chat') return
    const id = setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }, 0)
    return () => clearTimeout(id)
  }, [chatMessages, isMobile, activeTab])

  const pollForReply = useCallback(async (msgId: string) => {
    // 最长等待约 3 分钟
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1500))
      try {
        const res = await fetch(`/api/chat/poll?msgId=${msgId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.ready && data.message?.content) {
            setChatMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, content: data.message.content } : m
            ))
            setPendingMsgId(null)
            return
          }
        }
      } catch {}
    }

    // 超时后先拉一次历史，避免“其实已回复但没刷新到”
    await loadChatHistory().catch(() => {})

    // 若还没拿到，提示用户可手动刷新
    setChatMessages(prev => prev.map(m =>
      m.id === msgId && m.content === '...' ? { ...m, content: '（还在路上，点右上角“刷新”）' } : m
    ))
    setPendingMsgId(null)
  }, [loadChatHistory])

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return
    const content = chatInput.trim()
    setChatInput('')
    setChatLoading(true)

    // 乐观更新：先加用户消息
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      content,
      role: 'user',
      createdAt: new Date().toISOString(),
    }
    setChatMessages(prev => [...prev, tempUserMsg])

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('发送失败')
      const data = await res.json()

      if (data.pending && data.agentMessageId) {
        // 路由到真实 Lobster：加 pending 占位
        const pendingMsg: ChatMessage = {
          id: data.agentMessageId,
          content: '...',
          role: 'agent',
          createdAt: new Date().toISOString(),
        }
        setChatMessages(prev => [...prev, pendingMsg])
        setPendingMsgId(data.agentMessageId)
        pollForReply(data.agentMessageId)
      } else if (data.agentMessage) {
        // LLM 直接回复
        setChatMessages(prev => [...prev, data.agentMessage])
      }
    } catch (e) {
      console.error('发送消息失败:', e)
      setChatMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        content: '发送失败，请重试 😔',
        role: 'agent',
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, chatLoading, pollForReply])

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

  // B04: 监听后台 AI 拆解完成事件，自动刷新任务列表和详情
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      console.log('[B04] AI 拆解完成事件', detail?.taskId)
      fetchTasks() // 刷新左侧列表（步骤数变化 + 清除"AI分配中"标记）
      if (detail?.taskId && detail.taskId === selectedId) {
        console.log('[B04] 当前任务拆解完成，刷新步骤详情')
        fetchTaskDetail(detail.taskId)
      }
    }
    window.addEventListener('teamagent:task-parsed', handler)
    return () => window.removeEventListener('teamagent:task-parsed', handler)
  }, [selectedId, fetchTaskDetail])

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash && tasks.some(t => t.id === hash)) setSelectedId(hash)
    else if (tasks.length > 0 && !selectedId && !isMobile) {
      // 桌面端自动选第一个任务，移动端不自动选（进入聊天首页）
      setSelectedId(tasks[0].id)
    }
  }, [tasks, isMobile])

  useEffect(() => {
    if (selectedId) window.history.replaceState(null, '', `#${selectedId}`)
  }, [selectedId])

  // 移动端自适应：屏幕旋转 / 窗口缩放时自动折叠/展开侧边栏
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 768
      if (isMobile) {
        // 手机端始终折叠侧边栏（用抽屉模式）
        setSidebarCollapsed(true)
      }
      // 桌面端不强制展开，尊重用户手动操作
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  // 移动端：选择任务/创建/配对后自动关闭侧边栏
  const handleMobileClose = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarCollapsed(true)
    }
  }

  // ── 任务统计（用于移动端首页摘要）──────────────────────────────
  const pendingTaskCount = tasks.filter(t => t.status !== 'done').length
  const doneTaskCount = tasks.filter(t => t.status === 'done').length
  const totalStepsDone = tasks.reduce((sum, t) => sum + (t.steps?.filter((s: any) => s.status === 'done').length || 0), 0)
  const totalStepsAll = tasks.reduce((sum, t) => sum + (t.steps?.length || 0), 0)
  const hasStalePendingReply = chatMessages.some(m => m.role === 'agent' && m.content.includes('还在路上'))

  // ── 移动端布局 ──────────────────────────────────────────────────
  if (isMobile) {
    // 任务详情全屏（覆盖所有 tab）
    if (selectedTask) {
      return (
        <div className="h-[100svh] flex flex-col overflow-hidden bg-white">
          {/* 顶部返回栏 */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-3 py-3 flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => { setSelectedId(null); setSelectedTask(null) }}
              className="flex items-center space-x-1.5 text-slate-300 active:text-white px-2 py-1.5 rounded-lg"
            >
              <span className="text-base">←</span>
              <span className="text-xs">返回</span>
            </button>
            <span className="text-sm font-semibold text-white truncate max-w-[180px] mx-2">{selectedTask.title}</span>
            <div className="w-12" />
          </div>
          <TaskDetail
            task={selectedTask}
            onRefresh={handleRefresh}
            canApprove={(selectedTask as any).viewerIsCreator ?? (session?.user?.id === selectedTask.creator?.id || selectedTask.steps?.some((s: any) => s.assignee?.id === session?.user?.id))}
            onDelete={handleDelete}
            myAgent={myAgent}
            currentUserId={session?.user?.id || ''}
          />
        </div>
      )
    }

    return (
      <div className="h-[100dvh] flex flex-col overflow-hidden bg-gradient-to-b from-slate-900 to-slate-800">

        {/* ═══════════ 对话 Tab ═══════════ */}
        {activeTab === 'chat' && (
          <>

            {/* Agent 信息卡 */}
            <div className="px-4 pt-3 pb-2 flex-shrink-0 sticky top-0 z-20 bg-slate-900/95">
              <div className="flex items-center space-x-3 bg-slate-800/60 border border-slate-700/50 rounded-2xl px-4 py-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-orange-400 to-rose-500 flex items-center justify-center text-lg shadow-lg shadow-orange-500/20 flex-shrink-0">
                  🦞
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-white font-semibold text-sm">{myAgent?.name || 'AI 助手'}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded-md font-medium">主Agent</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${myAgent?.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                    <span className="text-slate-400 text-xs">{myAgent?.status === 'online' ? '在线 · 随时响应' : (myAgent ? '离线' : '未配对')}</span>
                  </div>
                </div>
                {tasks.length > 0 && (
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className="flex-shrink-0 flex flex-col items-end gap-0.5 active:opacity-70"
                  >
                    <span className="text-orange-300 text-xs font-semibold">📋 {pendingTaskCount} 待处理</span>
                    {doneTaskCount > 0 && <span className="text-emerald-400 text-xs">✅ {doneTaskCount} 完成</span>}
                  </button>
                )}
              </div>
            </div>

            {/* 聊天消息区 — 占据主体空间，overscroll-contain 防止页面抖动 */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-2 space-y-3 min-h-0">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div className="text-4xl mb-3">💬</div>
                  <p className="text-slate-400 text-sm">和你的 Agent 说点什么吧</p>
                  <p className="text-slate-600 text-xs mt-1">它能帮你管理任务、汇报进度</p>
                </div>
              ) : (
                chatMessages.map(msg => <ChatBubble key={msg.id} message={msg} />)
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 任务摘要已移入 Agent 名卡右侧，此处不再重复显示 */}

            {hasStalePendingReply && (
              <div className="px-4 pb-2 flex-shrink-0">
                <button
                  onClick={reloadChatHistory}
                  disabled={chatReloading}
                  className="w-full text-xs py-2 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-300 disabled:opacity-50"
                >
                  {chatReloading ? '重载中…' : '有消息可能超时了，点这里重载'}
                </button>
              </div>
            )}

            {/* 输入框 — 常驻 */}
            <div className="px-4 pb-3 pt-2 border-t border-slate-700/50 bg-slate-900/80 flex-shrink-0">
              <div className="flex items-center space-x-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSend())}
                  placeholder="和你的Agent说话..."
                  className="flex-1 bg-slate-800 text-white rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500/50 placeholder-slate-500 border border-slate-700/50"
                />
                <button
                  onClick={handleChatSend}
                  disabled={!chatInput.trim() || chatLoading}
                  className="w-11 h-11 rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 flex items-center justify-center disabled:opacity-40 transition-all active:scale-95 shadow-lg shadow-orange-500/30 flex-shrink-0"
                >
                  <span className="text-white text-lg">→</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* ═══════════ 任务 Tab ═══════════ */}
        {activeTab === 'tasks' && (
          <>
            {/* Tasks Banner */}
            <div className="px-4 pt-4 pb-3 flex-shrink-0 space-y-3 bg-gradient-to-br from-orange-500 to-rose-500 shadow-lg shadow-orange-500/20">
              {/* Title row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🤝</span>
                  <span className="text-white font-bold text-lg tracking-tight">TeamAgent</span>
                  {myAgent && (
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${myAgent.status === 'online' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  )}
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="text-xs px-3 py-1.5 bg-white/90 text-slate-800 rounded-xl font-semibold hover:bg-white transition"
                >
                  + 新建
                </button>
              </div>
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/20 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2 text-center">
                  <div className="text-white font-bold text-base leading-tight">{pendingTaskCount}</div>
                  <div className="text-white/60 text-xs mt-0.5">进行中</div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2 text-center">
                  <div className="text-white font-bold text-base leading-tight">{doneTaskCount}</div>
                  <div className="text-white/60 text-xs mt-0.5">已完成</div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2 text-center">
                  <div className="text-white font-bold text-base leading-tight">{totalStepsDone}<span className="text-white/50 text-xs font-normal">/{totalStepsAll}</span></div>
                  <div className="text-white/60 text-xs mt-0.5">步骤完成</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-4 min-h-0">
              {agentChecked && tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-slate-400 text-sm">还没有任务</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="mt-4 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold"
                  >
                    创建第一个任务
                  </button>
                </div>
              ) : (
                tasks.map((task, idx) => {
                  const stepsDone = task.steps?.filter(s => s.status === 'done').length || 0
                  const stepsTotal = task.steps?.length || 0
                  const hasWaiting = task.steps?.some(s => s.status === 'waiting_approval')
                  const st = statusConfig[task.status] || statusConfig.todo
                  const progress = stepsTotal > 0 ? Math.round((stepsDone / stepsTotal) * 100) : 0
                  // B04: 卡片上检测自动拆解中
                  const isAutoParsingCard = task.mode === 'team' && !!task.description && stepsTotal === 0
                    && (Date.now() - new Date(task.createdAt).getTime()) < 120_000

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedId(task.id)}
                      className={`rounded-2xl px-4 py-3 active:bg-slate-700/60 transition-colors cursor-pointer border ${
                        idx % 2 === 0
                          ? 'bg-slate-800/60 border-slate-700/50'
                          : 'bg-orange-950/30 border-orange-900/25'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className={`font-semibold text-sm flex-1 pr-2 leading-snug ${
                          idx % 2 === 0 ? 'text-slate-100' : 'text-orange-100'
                        }`}>{task.title}</span>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                          {hasWaiting && <span className="text-xs text-amber-400 font-medium">待审 ▶</span>}
                        </div>
                      </div>
                      {isAutoParsingCard ? (
                        <div className="flex items-center space-x-1.5 mt-2 animate-pulse">
                          <span className="text-xs text-orange-400 font-medium">🤖 AI 任务分配中…</span>
                        </div>
                      ) : stepsTotal > 0 ? (
                        <div className="flex items-center space-x-2 mt-2">
                          <div className={`flex-1 h-1 rounded-full overflow-hidden ${idx % 2 === 0 ? 'bg-slate-700' : 'bg-orange-900/40'}`}>
                            <div className="h-full bg-gradient-to-r from-orange-400 to-emerald-400" style={{ width: `${progress}%` }} />
                          </div>
                          <span className={`text-xs flex-shrink-0 ${idx % 2 === 0 ? 'text-slate-500' : 'text-orange-300/60'}`}>{stepsDone}/{stepsTotal}</span>
                        </div>
                      ) : null}
                      <div className={`text-xs mt-1 ${idx % 2 === 0 ? 'text-slate-600' : 'text-orange-400/40'}`}>{formatTime(task.updatedAt)}</div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {/* ═══════════ 我 Tab ═══════════ */}
        {activeTab === 'profile' && (
          <>
          <Navbar />
          <MobileProfileView
            userEmail={session?.user?.email || ''}
            userName={session?.user?.name || ''}
            onSignOut={() => router.push('/api/auth/signout')}
          />
          </>
        )}

        {/* 底部 spacer — 为全局固定 tab bar 留出空间 */}
        <div className="h-16 flex-shrink-0" />

        {/* Modals */}
        {showCreateModal && (
          <CreateTaskModal onClose={() => setShowCreateModal(false)} onCreated={(id) => { setShowCreateModal(false); fetchTasks(); setSelectedId(id) }} />
        )}
        {showPairingModal && (
          <PairingModal onClose={() => setShowPairingModal(false)} />
        )}
      </div>
    )
  }

  // ── 桌面端布局（原有逻辑）──────────────────────────────────────
  return (
    <div className="h-[100svh] flex flex-col overflow-hidden">
      {/* 无 Agent 引导 Banner */}
      {agentChecked && !myAgent && tasks.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            <span className="text-lg flex-shrink-0">⚡</span>
            <div className="min-w-0">
              <span className="font-semibold text-sm">还没有配对 Agent</span>
              <span className="text-amber-100 ml-2 text-xs hidden sm:inline">配对后任务步骤可以自动执行，不用手动操作</span>
            </div>
          </div>
          <button
            onClick={() => setShowPairingModal(true)}
            className="bg-white text-orange-600 font-semibold px-3 sm:px-4 py-1.5 rounded-xl text-xs hover:bg-orange-50 transition-colors flex items-center space-x-1.5 flex-shrink-0 ml-2"
          >
            <span>⊕</span>
            <span>配对</span>
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* 侧边栏 */}
        <div className="flex-shrink-0 flex" style={{ width: sidebarCollapsed ? '4rem' : '18rem' }}>
          <TaskList
            tasks={tasks}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onCreateNew={() => setShowCreateModal(true)}
            onPairAgent={() => setShowPairingModal(true)}
            currentUserId={session?.user?.id || ''}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            hasAgent={!!myAgent}
          />
        </div>

        {/* 主内容区 */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          {selectedTask ? (
            <TaskDetail
              task={selectedTask}
              onRefresh={handleRefresh}
              canApprove={(selectedTask as any).viewerIsCreator ?? (session?.user?.id === selectedTask.creator?.id || selectedTask.steps?.some((s: any) => s.assignee?.id === session?.user?.id))}
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

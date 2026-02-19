'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'
import Link from 'next/link'

// ============ Types ============

interface Submission {
  id: string
  result: string
  summary: string | null
  status: string // pending, approved, rejected
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
  assignee?: { id: string; name: string | null; avatar: string | null }
  assigneeNames?: string
  inputs?: string
  outputs?: string
  skills?: string
  attachments: { id: string; name: string; url: string }[]
  agentDurationMs?: number | null
  humanDurationMs?: number | null
  rejectionCount?: number
  rejectionReason?: string | null
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
  assignee?: { id: string; name: string | null; avatar: string | null }
  workspace?: { id: string; name: string }
  steps: TaskStep[]
  totalAgentTimeMs?: number | null
  totalHumanTimeMs?: number | null
  agentWorkRatio?: number | null
}

// ============ Utils ============

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  const hours = Math.floor(minutes / 60)
  return `${hours}小时${minutes % 60}分`
}

function parseJSON(str: string | undefined | null): string[] {
  if (!str) return []
  try {
    const parsed = JSON.parse(str)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// ============ Status Configs ============

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: '等待中', color: 'text-gray-600', bg: 'bg-gray-100', icon: '⏸️' },
  in_progress: { label: '进行中', color: 'text-blue-600', bg: 'bg-blue-100', icon: '🔄' },
  waiting_approval: { label: '待审批', color: 'text-yellow-600', bg: 'bg-yellow-100', icon: '👀' },
  done: { label: '已完成', color: 'text-green-600', bg: 'bg-green-100', icon: '✅' }
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: '低', color: 'bg-gray-100 text-gray-600' },
  medium: { label: '中', color: 'bg-blue-100 text-blue-600' },
  high: { label: '高', color: 'bg-orange-100 text-orange-600' },
  urgent: { label: '紧急', color: 'bg-red-100 text-red-600' }
}

// ============ Left Sidebar: Team + Stats ============

function LeftSidebar({ task }: { task: Task }) {
  // 提取团队成员
  const teamMap = new Map<string, {
    id: string
    name: string
    stepsAssigned: number
    stepsCompleted: number
    agentTimeMs: number
    humanTimeMs: number
    rejections: number
    currentStatus: string
  }>()

  for (const step of task.steps || []) {
    if (step.assignee) {
      const existing = teamMap.get(step.assignee.id)
      if (existing) {
        existing.stepsAssigned++
        if (step.status === 'done') existing.stepsCompleted++
        existing.agentTimeMs += step.agentDurationMs || 0
        existing.humanTimeMs += step.humanDurationMs || 0
        existing.rejections += step.rejectionCount || 0
        if (step.status === 'in_progress' || step.status === 'waiting_approval') {
          existing.currentStatus = step.status
        }
      } else {
        teamMap.set(step.assignee.id, {
          id: step.assignee.id,
          name: step.assignee.name || '未知',
          stepsAssigned: 1,
          stepsCompleted: step.status === 'done' ? 1 : 0,
          agentTimeMs: step.agentDurationMs || 0,
          humanTimeMs: step.humanDurationMs || 0,
          rejections: step.rejectionCount || 0,
          currentStatus: step.status
        })
      }
    }
  }

  const team = Array.from(teamMap.values())
  const totalAgent = task.totalAgentTimeMs || 0
  const totalHuman = task.totalHumanTimeMs || 0
  const total = totalAgent + totalHuman
  const agentPercent = total > 0 ? Math.round((totalAgent / total) * 100) : 0

  const statusIcon: Record<string, string> = {
    pending: '⚪',
    in_progress: '🔵',
    waiting_approval: '🟡',
    done: '🟢'
  }

  return (
    <div className="w-64 flex-shrink-0 space-y-4">
      {/* Team 面板 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
          <span className="mr-2">👥</span> 团队
        </h3>
        
        {team.length > 0 ? (
          <div className="space-y-2">
            {team.map(member => (
              <div key={member.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-medium">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{member.name}</div>
                    <div className="text-xs text-gray-400">
                      {statusIcon[member.currentStatus] || '⚪'} {member.stepsCompleted}/{member.stepsAssigned} 完成
                    </div>
                  </div>
                </div>
                {member.rejections > 0 && (
                  <span className="text-xs text-orange-500">🔄{member.rejections}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-4">暂无成员</div>
        )}
      </div>

      {/* 工作量统计 */}
      {total > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
            <span className="mr-2">⏱️</span> 工作量
          </h3>
          
          {/* 进度条 */}
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden mb-3 flex">
            <div className="bg-blue-500 h-full" style={{ width: `${agentPercent}%` }} />
            <div className="bg-purple-500 h-full" style={{ width: `${100 - agentPercent}%` }} />
          </div>
          
          {/* 数据 */}
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">🤖 Agent</span>
              <span className="text-gray-700">{formatDuration(totalAgent)} ({agentPercent}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">👤 人类</span>
              <span className="text-gray-700">{formatDuration(totalHuman)} ({100 - agentPercent}%)</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-100 mt-2">
              <span className="text-gray-500">总计</span>
              <span className="font-medium text-gray-800">{formatDuration(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 创建者信息 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="text-xs text-gray-400 mb-1">创建者</div>
        <div className="text-sm text-gray-700">{task.creator?.name || task.creator?.email}</div>
        <div className="text-xs text-gray-400 mt-2 mb-1">工作区</div>
        <div className="text-sm text-gray-700">{task.workspace?.name}</div>
        <div className="text-xs text-gray-400 mt-2 mb-1">创建时间</div>
        <div className="text-sm text-gray-700">{formatTime(task.createdAt)}</div>
      </div>
    </div>
  )
}

// ============ Step Card (Collapsible) ============

function StepCard({
  step,
  index,
  isActive,
  onApprove,
  onReject,
  canApprove,
  onRefresh
}: {
  step: TaskStep
  index: number
  isActive: boolean
  onApprove?: (stepId: string) => Promise<void>
  onReject?: (stepId: string, reason: string) => Promise<void>
  canApprove?: boolean
  onRefresh?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<Submission[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const status = statusConfig[step.status] || statusConfig.pending
  const assigneeNames = parseJSON(step.assigneeNames)
  const isWaitingApproval = step.status === 'waiting_approval'

  // 加载提交历史
  const loadHistory = async () => {
    if (history.length > 0) return // 已加载
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/steps/${step.id}/history`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data.history || [])
      }
    } catch (e) {
      console.error('加载历史失败', e)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleExpand = () => {
    const newExpanded = !expanded
    setExpanded(newExpanded)
    if (newExpanded) {
      loadHistory()
    }
  }

  const handleApprove = async () => {
    if (!onApprove) return
    setSubmitting(true)
    try {
      await onApprove(step.id)
      onRefresh?.()
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!onReject || !rejectReason.trim()) return
    setSubmitting(true)
    try {
      await onReject(step.id, rejectReason)
      setRejectReason('')
      setShowRejectForm(false)
      onRefresh?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative pl-8 pb-6">
      {/* 连接线 */}
      <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-gray-200" />

      {/* 节点圆点 */}
      <div className={`absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
        ${step.status === 'done' ? 'bg-green-500 text-white' 
          : isActive ? 'bg-blue-500 text-white' 
          : 'bg-gray-200 text-gray-500'}`}>
        {step.status === 'done' ? '✓' : index + 1}
      </div>

      {/* 卡片 */}
      <div className={`bg-white rounded-xl border-2 transition-all
        ${isActive ? 'border-blue-400 shadow-md' : 'border-gray-100 hover:border-gray-200'}`}>
        
        {/* 头部：点击展开 */}
        <div 
          className="p-4 cursor-pointer select-none"
          onClick={handleExpand}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h3 className="font-semibold text-gray-900">{step.title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                {status.icon} {status.label}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              {/* 责任人 */}
              {assigneeNames.length > 0 && (
                <div className="flex -space-x-1">
                  {assigneeNames.slice(0, 3).map((name, i) => (
                    <div key={i} className="w-6 h-6 rounded-full bg-purple-100 border-2 border-white flex items-center justify-center text-xs text-purple-700">
                      {name.charAt(0)}
                    </div>
                  ))}
                </div>
              )}
              {/* 展开图标 */}
              <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </div>
          </div>

          {/* 简要信息（未展开时） */}
          {!expanded && step.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-1">{step.description}</p>
          )}

          {/* 被拒绝的提示 */}
          {!expanded && step.rejectionReason && step.status === 'pending' && (
            <div className="mt-2 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
              🔄 被打回: {step.rejectionReason.slice(0, 50)}...
            </div>
          )}
        </div>

        {/* 展开内容 */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-gray-100">
            {/* 描述 */}
            {step.description && (
              <p className="text-sm text-gray-600 mt-3 mb-3">{step.description}</p>
            )}

            {/* 当前结果 */}
            {step.result && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">📝 当前结果</div>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{step.result}</pre>
              </div>
            )}

            {/* 附件 */}
            {step.attachments?.length > 0 && (
              <div className="mt-3 space-y-1">
                {step.attachments.map(att => (
                  <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800">
                    <span>📎</span><span>{att.name}</span>
                  </a>
                ))}
              </div>
            )}

            {/* 提交历史 */}
            {loadingHistory ? (
              <div className="mt-4 text-sm text-gray-400">加载历史中...</div>
            ) : history.length > 0 ? (
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-2">📜 提交历史 ({history.length})</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {history.map((sub, i) => (
                    <SubmissionCard key={sub.id} submission={sub} index={i} />
                  ))}
                </div>
              </div>
            ) : null}

            {/* 审批区域 */}
            {isWaitingApproval && canApprove && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="text-sm font-medium text-yellow-700 mb-3">⏳ 等待审核</div>
                
                {showRejectForm ? (
                  <div className="space-y-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="请说明需要修改的内容..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-red-500"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex space-x-2">
                      <button onClick={handleReject} disabled={submitting || !rejectReason.trim()}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm">
                        {submitting ? '提交中...' : '❌ 确认打回'}
                      </button>
                      <button onClick={() => { setShowRejectForm(false); setRejectReason('') }}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex space-x-2">
                    <button onClick={handleApprove} disabled={submitting}
                      className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 text-sm font-medium">
                      {submitting ? '提交中...' : '✅ 通过'}
                    </button>
                    <button onClick={() => setShowRejectForm(true)} disabled={submitting}
                      className="flex-1 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50 text-sm font-medium">
                      ❌ 打回
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 时间统计 */}
            {step.status === 'done' && (step.agentDurationMs || step.humanDurationMs) && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center space-x-4 text-xs text-gray-500">
                {step.agentDurationMs && <span>🤖 {formatDuration(step.agentDurationMs)}</span>}
                {step.humanDurationMs && <span>👤 {formatDuration(step.humanDurationMs)}</span>}
                {(step.rejectionCount || 0) > 0 && (
                  <span className="text-orange-500">🔄 打回 {step.rejectionCount} 次</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Submission Card ============

function SubmissionCard({ submission, index }: { submission: Submission; index: number }) {
  const [expanded, setExpanded] = useState(index === 0) // 最新的默认展开
  
  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700'
  }
  const statusLabels: Record<string, string> = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已打回'
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* 头部 */}
      <div 
        className="px-3 py-2 bg-gray-50 cursor-pointer flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center space-x-2 text-xs">
          <span className={`px-2 py-0.5 rounded ${statusColors[submission.status]}`}>
            {statusLabels[submission.status]}
          </span>
          <span className="text-gray-500">{formatTime(submission.createdAt)}</span>
          <span className="text-gray-400">by {submission.submitter.name}</span>
        </div>
        <span className={`text-gray-400 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </div>
      
      {/* 展开内容 */}
      {expanded && (
        <div className="px-3 py-2 text-sm">
          {/* 结果 */}
          <pre className="whitespace-pre-wrap font-sans text-gray-700 text-xs mb-2">{submission.result}</pre>
          
          {/* 审核信息 */}
          {submission.reviewedAt && (
            <div className={`text-xs p-2 rounded mt-2 ${
              submission.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
            }`}>
              <div>
                {submission.status === 'rejected' ? '❌' : '✅'} 
                {submission.reviewedBy?.name} · {formatTime(submission.reviewedAt)}
              </div>
              {submission.reviewNote && (
                <div className="mt-1">{submission.reviewNote}</div>
              )}
            </div>
          )}

          {/* 附件 */}
          {submission.attachments?.length > 0 && (
            <div className="mt-2 space-y-1">
              {submission.attachments.map(att => (
                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-800">
                  <span>📎</span><span>{att.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ Main Page ============

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session, status } = useSession()
  const router = useRouter()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddStep, setShowAddStep] = useState(false)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [addingStep, setAddingStep] = useState(false)
  const [parsing, setParsing] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  useEffect(() => {
    if (session && id) {
      fetchTask()
    }
  }, [session, id])

  const fetchTask = async () => {
    try {
      const res = await fetch(`/api/tasks/${id}`)
      if (res.ok) {
        const data = await res.json()
        setTask(data)
      } else {
        router.push('/')
      }
    } catch (e) {
      console.error('获取任务失败', e)
    } finally {
      setLoading(false)
    }
  }

  const addStep = async () => {
    if (!newStepTitle.trim()) return
    setAddingStep(true)
    try {
      const res = await fetch(`/api/tasks/${id}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newStepTitle })
      })
      if (res.ok) {
        setNewStepTitle('')
        setShowAddStep(false)
        fetchTask()
      }
    } catch (e) {
      console.error('添加步骤失败', e)
    } finally {
      setAddingStep(false)
    }
  }

  const parseTask = async () => {
    if (!task?.description) {
      alert('任务没有描述，无法自动拆解')
      return
    }
    setParsing(true)
    try {
      const res = await fetch(`/api/tasks/${id}/parse`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        alert(`🎉 ${data.message}`)
        fetchTask()
      } else {
        alert(data.error || '拆解失败')
      }
    } catch (e) {
      alert('拆解任务失败')
    } finally {
      setParsing(false)
    }
  }

  const handleApprove = async (stepId: string) => {
    const res = await fetch(`/api/steps/${stepId}/approve`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      alert(data.error || '审批失败')
    }
  }

  const handleReject = async (stepId: string, reason: string) => {
    const res = await fetch(`/api/steps/${stepId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    if (!res.ok) {
      const data = await res.json()
      alert(data.error || '打回失败')
    }
  }

  const canApprove = session?.user?.id === task?.creator?.id

  if (status === 'loading' || loading) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-6 py-8">
          <div className="animate-pulse">加载中...</div>
        </main>
      </>
    )
  }

  if (!task) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-center text-gray-500">任务不存在</div>
        </main>
      </>
    )
  }

  const priority = priorityConfig[task.priority] || priorityConfig.medium
  const taskStatus = statusConfig[task.status] || statusConfig.pending
  const currentStepIndex = task.steps?.findIndex(s => s.status !== 'done') ?? -1

  return (
    <>
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 返回 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
          ← 返回看板
        </Link>

        {/* 任务头部 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <span className={`text-xs px-2 py-1 rounded-full ${priority.color}`}>
                  {priority.label}优先级
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${taskStatus.bg} ${taskStatus.color}`}>
                  {taskStatus.icon} {taskStatus.label}
                </span>
                {task.dueDate && (
                  <span className="text-xs text-gray-500">
                    📅 {new Date(task.dueDate).toLocaleDateString('zh-CN')}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
              {task.description && (
                <p className="text-gray-600 mt-2">{task.description}</p>
              )}
            </div>
            
            {/* 操作按钮 */}
            {session?.user?.id === task.creator?.id && (
              <div className="flex items-center space-x-2">
                {/* 邀请协作者 */}
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/tasks/${task.id}/invite`, { method: 'POST' })
                    const data = await res.json()
                    if (res.ok) {
                      navigator.clipboard.writeText(data.inviteUrl).catch(() => {})
                      alert(`✅ 邀请链接已复制！\n\n${data.inviteUrl}\n\n7天内有效，发给协作者即可。`)
                    } else {
                      alert(data.error || '生成邀请链接失败')
                    }
                  }}
                  className="text-sm text-orange-500 hover:text-orange-700 hover:bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-200"
                >
                  🔗 邀请协作者
                </button>
                {/* 删除 */}
                <button
                  onClick={async () => {
                    if (!confirm('确定要删除这个任务吗？')) return
                    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
                    if (res.ok) router.push('/')
                    else alert('删除失败')
                  }}
                  className="text-sm text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg"
                >
                  🗑️ 删除
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 主体：左右布局 */}
        <div className="flex gap-6">
          {/* 左侧边栏 */}
          <LeftSidebar task={task} />

          {/* 右侧：工作流程 */}
          <div className="flex-1 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-800">📋 工作流程</h2>
              <div className="flex items-center space-x-3">
                {task.description && (!task.steps || task.steps.length === 0) && (
                  <button
                    className="text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                    onClick={parseTask}
                    disabled={parsing}
                  >
                    {parsing ? '🤖 拆解中...' : '🤖 AI 自动拆解'}
                  </button>
                )}
                <button
                  className="text-sm text-blue-600 hover:text-blue-800"
                  onClick={() => setShowAddStep(true)}
                >
                  + 添加步骤
                </button>
              </div>
            </div>

            {/* 添加步骤表单 */}
            {showAddStep && (
              <div className="mb-6 p-4 bg-blue-50 rounded-xl">
                <input
                  type="text"
                  value={newStepTitle}
                  onChange={(e) => setNewStepTitle(e.target.value)}
                  placeholder="步骤标题"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-3"
                  autoFocus
                />
                <div className="flex space-x-2">
                  <button onClick={addStep} disabled={addingStep || !newStepTitle.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                    {addingStep ? '添加中...' : '添加'}
                  </button>
                  <button onClick={() => { setShowAddStep(false); setNewStepTitle('') }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* 步骤列表 */}
            {task.steps && task.steps.length > 0 ? (
              <div className="relative">
                {task.steps
                  .sort((a, b) => a.order - b.order)
                  .map((step, index) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      index={index}
                      isActive={index === currentStepIndex}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      canApprove={canApprove}
                      onRefresh={fetchTask}
                    />
                  ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-3">📝</div>
                <p>还没有工作流程步骤</p>
                <p className="text-sm mt-1">点击"添加步骤"或"AI 自动拆解"</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}

'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'
import Link from 'next/link'

interface TaskStep {
  id: string
  title: string
  description: string | null
  order: number
  status: string
  agentStatus: string | null
  result: string | null
  assignee?: { id: string; name: string | null; avatar: string | null }
  assigneeNames?: string  // JSON string of names
  inputs?: string        // JSON string
  outputs?: string       // JSON string
  skills?: string        // JSON string
  attachments: { id: string; name: string; url: string }[]
  // 时间追踪
  agentDurationMs?: number | null
  humanDurationMs?: number | null
  rejectionCount?: number
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
  // 时间统计
  totalAgentTimeMs?: number | null
  totalHumanTimeMs?: number | null
  agentWorkRatio?: number | null
}

interface TaskStepWithTime extends TaskStep {
  agentDurationMs?: number | null
  humanDurationMs?: number | null
  rejectionCount?: number
}

// 格式化时间
function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  const hours = Math.floor(minutes / 60)
  return `${hours}小时${minutes % 60}分`
}

// 时间统计卡片
function TimeStats({ task }: { task: Task }) {
  const totalAgent = task.totalAgentTimeMs || 0
  const totalHuman = task.totalHumanTimeMs || 0
  const total = totalAgent + totalHuman
  const ratio = task.agentWorkRatio
  
  if (total === 0) return null
  
  const agentPercent = ratio ? Math.round(ratio * 100) : 0
  const humanPercent = 100 - agentPercent

  return (
    <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 mb-6 border border-blue-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">⏱️ 工作量统计</h3>
        <span className="text-xs text-gray-500">总耗时: {formatDuration(total)}</span>
      </div>
      
      {/* 进度条 */}
      <div className="h-4 bg-gray-200 rounded-full overflow-hidden mb-3 flex">
        <div 
          className="bg-blue-500 h-full transition-all duration-500"
          style={{ width: `${agentPercent}%` }}
        />
        <div 
          className="bg-purple-500 h-full transition-all duration-500"
          style={{ width: `${humanPercent}%` }}
        />
      </div>
      
      {/* 图例 */}
      <div className="flex justify-between text-xs">
        <div className="flex items-center space-x-4">
          <span className="flex items-center">
            <span className="w-3 h-3 bg-blue-500 rounded-full mr-1"></span>
            🤖 Agent: {formatDuration(totalAgent)} ({agentPercent}%)
          </span>
          <span className="flex items-center">
            <span className="w-3 h-3 bg-purple-500 rounded-full mr-1"></span>
            👤 人类: {formatDuration(totalHuman)} ({humanPercent}%)
          </span>
        </div>
      </div>
      
      {/* 智能洞察 */}
      <Insights 
        agentPercent={agentPercent} 
        humanPercent={humanPercent}
        totalAgent={totalAgent}
        totalHuman={totalHuman}
        steps={task.steps}
      />
    </div>
  )
}

// 智能洞察组件
function Insights({ 
  agentPercent, 
  humanPercent, 
  totalAgent, 
  totalHuman,
  steps 
}: { 
  agentPercent: number
  humanPercent: number
  totalAgent: number
  totalHuman: number
  steps: TaskStep[]
}) {
  const insights: { icon: string; text: string; type: 'info' | 'suggestion' | 'warning' }[] = []
  
  // 分析审核时间占比
  if (humanPercent > 90) {
    insights.push({
      icon: '🔍',
      text: `审核时间占 ${humanPercent}%，Agent 执行效率高。这说明人类的价值在于"质量把关"而非"执行"。`,
      type: 'info'
    })
    
    if (totalHuman > 5 * 60 * 1000) { // 超过5分钟
      insights.push({
        icon: '💡',
        text: '考虑添加"预审 Agent"来预筛结果，减轻人类审核负担。',
        type: 'suggestion'
      })
    }
  }
  
  // 检查打回次数
  const rejectedSteps = steps.filter(s => (s.rejectionCount || 0) > 0)
  if (rejectedSteps.length > 0) {
    const totalRejections = rejectedSteps.reduce((sum, s) => sum + (s.rejectionCount || 0), 0)
    insights.push({
      icon: '🔄',
      text: `共有 ${totalRejections} 次打回。可以分析打回原因，优化 Agent 的 prompt 或能力。`,
      type: 'warning'
    })
  }
  
  // Agent 效率洞察
  if (agentPercent < 10 && totalAgent > 0) {
    insights.push({
      icon: '⚡',
      text: 'Agent 执行速度极快，瓶颈在人类决策环节。这是正常的——复杂决策本应由人类把关。',
      type: 'info'
    })
  }
  
  // 如果没有洞察
  if (insights.length === 0) {
    return null
  }
  
  return (
    <div className="mt-4 pt-3 border-t border-blue-100">
      <div className="text-xs font-medium text-gray-600 mb-2">💡 智能洞察</div>
      <div className="space-y-2">
        {insights.map((insight, i) => (
          <div 
            key={i} 
            className={`text-xs p-2 rounded-lg ${
              insight.type === 'warning' 
                ? 'bg-orange-50 text-orange-700'
                : insight.type === 'suggestion'
                ? 'bg-green-50 text-green-700'
                : 'bg-gray-50 text-gray-600'
            }`}
          >
            {insight.icon} {insight.text}
          </div>
        ))}
      </div>
    </div>
  )
}

// Team 成员统计
interface TeamMember {
  id: string
  name: string
  avatar?: string | null
  stepsAssigned: number
  stepsCompleted: number
  agentTimeMs: number
  humanTimeMs: number
  rejections: number
  status: 'idle' | 'working' | 'reviewing' | 'done'
}

function TeamPanel({ task }: { task: Task }) {
  // 从 steps 中提取团队成员统计
  const teamMap = new Map<string, TeamMember>()
  
  // 添加创建者
  if (task.creator) {
    teamMap.set(task.creator.id, {
      id: task.creator.id,
      name: task.creator.name || task.creator.email || '未知',
      avatar: null,
      stepsAssigned: 0,
      stepsCompleted: 0,
      agentTimeMs: 0,
      humanTimeMs: 0,
      rejections: 0,
      status: 'idle'
    })
  }
  
  // 遍历 steps 统计每个成员
  for (const step of task.steps || []) {
    if (step.assignee) {
      const existing = teamMap.get(step.assignee.id)
      if (existing) {
        existing.stepsAssigned++
        if (step.status === 'done') existing.stepsCompleted++
        existing.agentTimeMs += step.agentDurationMs || 0
        existing.humanTimeMs += step.humanDurationMs || 0
        existing.rejections += step.rejectionCount || 0
        // 更新状态
        if (step.status === 'in_progress') existing.status = 'working'
        else if (step.status === 'waiting_approval') existing.status = 'reviewing'
      } else {
        teamMap.set(step.assignee.id, {
          id: step.assignee.id,
          name: step.assignee.name || '未知',
          avatar: step.assignee.avatar,
          stepsAssigned: 1,
          stepsCompleted: step.status === 'done' ? 1 : 0,
          agentTimeMs: step.agentDurationMs || 0,
          humanTimeMs: step.humanDurationMs || 0,
          rejections: step.rejectionCount || 0,
          status: step.status === 'in_progress' ? 'working' 
               : step.status === 'waiting_approval' ? 'reviewing' 
               : step.status === 'done' ? 'done' : 'idle'
        })
      }
    }
  }
  
  const team = Array.from(teamMap.values())
  
  if (team.length === 0) return null
  
  const statusIcons: Record<string, string> = {
    idle: '⚪',
    working: '🔵',
    reviewing: '🟡',
    done: '🟢'
  }
  
  const statusLabels: Record<string, string> = {
    idle: '待命',
    working: '执行中',
    reviewing: '待审核',
    done: '已完成'
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">👥 Team</h3>
      <div className="space-y-3">
        {team.map(member => {
          const totalTime = member.agentTimeMs + member.humanTimeMs
          const agentPercent = totalTime > 0 ? Math.round((member.agentTimeMs / totalTime) * 100) : 0
          
          return (
            <div key={member.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                {/* 头像 */}
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                  {member.name.charAt(0)}
                </div>
                
                {/* 名字和状态 */}
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {member.name}
                    {task.creator?.id === member.id && (
                      <span className="ml-1 text-xs text-gray-400">(创建者)</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {statusIcons[member.status]} {statusLabels[member.status]}
                    {member.stepsAssigned > 0 && (
                      <span className="ml-2">
                        · {member.stepsCompleted}/{member.stepsAssigned} 步骤
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {/* 贡献统计 */}
              {totalTime > 0 && (
                <div className="text-right">
                  <div className="text-xs text-gray-600">
                    🤖 {formatDuration(member.agentTimeMs)} ({agentPercent}%)
                  </div>
                  <div className="text-xs text-gray-600">
                    👤 {formatDuration(member.humanTimeMs)} ({100 - agentPercent}%)
                  </div>
                  {member.rejections > 0 && (
                    <div className="text-xs text-orange-500">
                      🔄 {member.rejections} 次打回
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      {/* 团队总计 */}
      {team.length > 1 && (
        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
          团队共 {team.length} 人 · 
          总 Agent 时间: {formatDuration(team.reduce((sum, m) => sum + m.agentTimeMs, 0))} · 
          总人类时间: {formatDuration(team.reduce((sum, m) => sum + m.humanTimeMs, 0))}
        </div>
      )}
    </div>
  )
}

// 状态配置
const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: '等待中', color: 'bg-gray-100 text-gray-600', icon: '⏸️' },
  in_progress: { label: '进行中', color: 'bg-blue-100 text-blue-600', icon: '🔄' },
  waiting_approval: { label: '待审批', color: 'bg-yellow-100 text-yellow-600', icon: '👀' },
  done: { label: '已完成', color: 'bg-green-100 text-green-600', icon: '✅' }
}

// Agent 状态配置
const agentStatusConfig: Record<string, { label: string; color: string; icon: string }> = {
  online: { label: '在线', color: 'text-green-600', icon: '🟢' },
  working: { label: '干活中', color: 'text-blue-600', icon: '🔵' },
  waiting: { label: '等待中', color: 'text-yellow-600', icon: '🟡' },
  offline: { label: '离线', color: 'text-gray-400', icon: '⚫' },
  error: { label: '出错了', color: 'text-red-600', icon: '🔴' }
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: '低', color: 'bg-gray-100 text-gray-600' },
  medium: { label: '中', color: 'bg-blue-100 text-blue-600' },
  high: { label: '高', color: 'bg-orange-100 text-orange-600' },
  urgent: { label: '紧急', color: 'bg-red-100 text-red-600' }
}

// 解析 JSON 字符串
function parseJSON(str: string | undefined | null): string[] {
  if (!str) return []
  try {
    const parsed = JSON.parse(str)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 步骤卡片
function StepCard({ 
  step, 
  index, 
  isActive,
  onApprove,
  onReject,
  canApprove
}: { 
  step: TaskStep
  index: number
  isActive: boolean
  onApprove?: (stepId: string, comment: string) => Promise<void>
  onReject?: (stepId: string, reason: string) => Promise<void>
  canApprove?: boolean
}) {
  const [showDetail, setShowDetail] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [approveComment, setApproveComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const status = statusConfig[step.status] || statusConfig.pending
  const agentStatus = step.agentStatus ? agentStatusConfig[step.agentStatus] : null
  
  // 解析 JSON 字段
  const assigneeNames = parseJSON(step.assigneeNames)
  const inputs = parseJSON(step.inputs)
  const outputs = parseJSON(step.outputs)
  const skills = parseJSON(step.skills)

  const handleApprove = async () => {
    if (!onApprove) return
    setSubmitting(true)
    try {
      await onApprove(step.id, approveComment)
      setApproveComment('')
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
    } finally {
      setSubmitting(false)
    }
  }

  const isWaitingApproval = step.status === 'waiting_approval'

  return (
    <div className={`relative pl-8 pb-8 ${index === 0 ? '' : ''}`}>
      {/* 连接线 */}
      <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-gray-200"></div>
      
      {/* 节点圆点 */}
      <div className={`absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center text-sm
        ${isActive ? 'bg-blue-500 text-white' : step.status === 'done' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
        {step.status === 'done' ? '✓' : index + 1}
      </div>

      {/* 步骤内容 */}
      <div className={`bg-white rounded-xl p-4 border-2 transition
        ${isActive ? 'border-blue-500 shadow-md' : 'border-gray-100'}`}>
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-gray-900">{step.title}</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${status.color}`}>
            {status.icon} {status.label}
          </span>
        </div>

        {step.description && (
          <p className="text-sm text-gray-600 mb-3">{step.description}</p>
        )}

        {/* 责任人 + Agent 状态 */}
        <div className="flex items-center flex-wrap gap-2 mb-3">
          <span className="text-xs text-gray-500">责任人:</span>
          {assigneeNames.length > 0 ? (
            assigneeNames.map((name, i) => (
              <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                {name}
              </span>
            ))
          ) : step.assignee ? (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
              {step.assignee.name}
            </span>
          ) : (
            <span className="text-xs text-gray-400">待分配</span>
          )}
          
          {agentStatus && (
            <span className={`text-xs ${agentStatus.color} ml-2`}>
              {agentStatus.icon} Agent {agentStatus.label}
            </span>
          )}
          
          {/* 时间统计 - 已完成步骤显示 */}
          {step.status === 'done' && (step.agentDurationMs || step.humanDurationMs) && (
            <span className="text-xs text-gray-400 ml-auto flex items-center space-x-2">
              {step.agentDurationMs && (
                <span>🤖 {formatDuration(step.agentDurationMs)}</span>
              )}
              {step.humanDurationMs && (
                <span>👤 {formatDuration(step.humanDurationMs)}</span>
              )}
              {step.rejectionCount && step.rejectionCount > 0 && (
                <span className="text-orange-500">🔄 打回{step.rejectionCount}次</span>
              )}
            </span>
          )}
        </div>

        {/* 输入/输出/Skills */}
        <div className="grid grid-cols-3 gap-2 text-xs mb-3">
          {inputs.length > 0 && (
            <div className="bg-blue-50 p-2 rounded">
              <div className="text-blue-600 font-medium mb-1">📥 输入</div>
              {inputs.map((item, i) => (
                <div key={i} className="text-blue-700">{item}</div>
              ))}
            </div>
          )}
          {outputs.length > 0 && (
            <div className="bg-green-50 p-2 rounded">
              <div className="text-green-600 font-medium mb-1">📤 产出</div>
              {outputs.map((item, i) => (
                <div key={i} className="text-green-700">{item}</div>
              ))}
            </div>
          )}
          {skills.length > 0 && (
            <div className="bg-orange-50 p-2 rounded">
              <div className="text-orange-600 font-medium mb-1">🔧 Skill</div>
              {skills.map((item, i) => (
                <div key={i} className="text-orange-700">{item}</div>
              ))}
            </div>
          )}
        </div>

        {/* 结果/产出 */}
        {step.result && (
          <div className="mt-3 p-3 bg-green-50 rounded-lg">
            <p className="text-sm text-green-800">
              <span className="font-medium">结果：</span>{step.result}
            </p>
          </div>
        )}

        {/* 附件 */}
        {step.attachments && step.attachments.length > 0 && (
          <div className="mt-3 space-y-1">
            {step.attachments.map(att => (
              <a
                key={att.id}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
              >
                <span>📎</span>
                <span>{att.name}</span>
              </a>
            ))}
          </div>
        )}

        {/* 审批区域 - 只在等待审批状态显示 */}
        {isWaitingApproval && canApprove && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-sm font-medium text-yellow-700 mb-3">
              ⏳ 等待你的审核
            </div>

            {/* 查看详情按钮 */}
            {step.result && (
              <button
                onClick={() => setShowDetail(!showDetail)}
                className="text-sm text-blue-600 hover:text-blue-800 mb-3 flex items-center"
              >
                {showDetail ? '🔼 收起详情' : '🔽 查看提交内容'}
              </button>
            )}

            {/* 展开的详情 */}
            {showDetail && step.result && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                  {step.result}
                </pre>
              </div>
            )}

            {/* 打回表单 */}
            {showRejectForm ? (
              <div className="space-y-3">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="请说明需要修改的内容..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  rows={3}
                  autoFocus
                />
                <div className="flex space-x-2">
                  <button
                    onClick={handleReject}
                    disabled={submitting || !rejectReason.trim()}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm"
                  >
                    {submitting ? '提交中...' : '❌ 确认打回'}
                  </button>
                  <button
                    onClick={() => { setShowRejectForm(false); setRejectReason('') }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 评论输入 */}
                <input
                  type="text"
                  value={approveComment}
                  onChange={(e) => setApproveComment(e.target.value)}
                  placeholder="添加评论（可选）"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                
                {/* 审批按钮 */}
                <div className="flex space-x-2">
                  <button
                    onClick={handleApprove}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 text-sm font-medium"
                  >
                    {submitting ? '提交中...' : '✅ 通过'}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(true)}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50 text-sm font-medium"
                  >
                    ❌ 打回修改
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 已通过状态 */}
        {step.status === 'done' && (
          <div className="mt-3 text-sm text-green-600">
            ✅ 已通过审核
          </div>
        )}
      </div>
    </div>
  )
}

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
        fetchTask() // 刷新任务数据
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
      const res = await fetch(`/api/tasks/${id}/parse`, {
        method: 'POST'
      })
      const data = await res.json()
      if (res.ok) {
        alert(`🎉 ${data.message}`)
        fetchTask()
      } else {
        alert(data.error || '拆解失败')
      }
    } catch (e) {
      console.error('拆解任务失败', e)
      alert('拆解任务失败')
    } finally {
      setParsing(false)
    }
  }

  // 审批通过
  const handleApprove = async (stepId: string, comment: string) => {
    try {
      const res = await fetch(`/api/steps/${stepId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment })
      })
      const data = await res.json()
      if (res.ok) {
        alert('✅ 已通过！')
        fetchTask() // 刷新任务数据
      } else {
        alert(data.error || '审批失败')
      }
    } catch (e) {
      console.error('审批失败', e)
      alert('审批失败')
    }
  }

  // 打回修改
  const handleReject = async (stepId: string, reason: string) => {
    try {
      const res = await fetch(`/api/steps/${stepId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      const data = await res.json()
      if (res.ok) {
        alert('❌ 已打回，Agent 会收到通知重做')
        fetchTask()
      } else {
        alert(data.error || '打回失败')
      }
    } catch (e) {
      console.error('打回失败', e)
      alert('打回失败')
    }
  }

  // 检查当前用户是否可以审批（任务创建者可以审批）
  const canApprove = session?.user?.id === task?.creator?.id

  if (status === 'loading' || loading) {
    return (
      <>
        <Navbar />
        <main className="max-w-4xl mx-auto px-6 py-8">
          <div className="animate-pulse">加载中...</div>
        </main>
      </>
    )
  }

  if (!task) {
    return (
      <>
        <Navbar />
        <main className="max-w-4xl mx-auto px-6 py-8">
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
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* 返回 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block">
          ← 返回看板
        </Link>

        {/* 任务头部 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <span className={`text-xs px-2 py-1 rounded-full ${priority.color}`}>
                  {priority.label}优先级
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${taskStatus.color}`}>
                  {taskStatus.icon} {taskStatus.label}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
            </div>
            {task.dueDate && (
              <div className="text-right">
                <div className="text-xs text-gray-500">截止日期</div>
                <div className="text-sm font-medium text-gray-700">
                  {new Date(task.dueDate).toLocaleDateString('zh-CN')}
                </div>
              </div>
            )}
          </div>

          {task.description && (
            <p className="text-gray-600 mb-4">{task.description}</p>
          )}

          <div className="flex items-center space-x-6 text-sm text-gray-500">
            <div>
              <span className="text-gray-400">创建者：</span>
              {task.creator?.name || task.creator?.email}
            </div>
            <div>
              <span className="text-gray-400">工作区：</span>
              {task.workspace?.name}
            </div>
            <div>
              <span className="text-gray-400">创建于：</span>
              {new Date(task.createdAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>

        {/* 时间统计 */}
        <TimeStats task={task} />

        {/* Team 面板 */}
        <TeamPanel task={task} />

        {/* 工作流步骤 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-800">📋 工作流程</h2>
            <div className="flex items-center space-x-3">
              {task.description && (!task.steps || task.steps.length === 0) && (
                <button
                  className="text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white px-3 py-1.5 rounded-lg hover:from-purple-600 hover:to-pink-600 disabled:opacity-50"
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
                placeholder="步骤标题，如：准备材料"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              <div className="flex space-x-2">
                <button
                  onClick={addStep}
                  disabled={addingStep || !newStepTitle.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {addingStep ? '添加中...' : '添加'}
                </button>
                <button
                  onClick={() => { setShowAddStep(false); setNewStepTitle('') }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          )}

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
                  />
                ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">📝</div>
              <p>还没有工作流程步骤</p>
              <p className="text-sm mt-1">点击上方"添加步骤"来创建工作流</p>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

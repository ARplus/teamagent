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
    return JSON.parse(str)
  } catch {
    return []
  }
}

// 步骤卡片
function StepCard({ step, index, isActive }: { step: TaskStep; index: number; isActive: boolean }) {
  const status = statusConfig[step.status] || statusConfig.pending
  const agentStatus = step.agentStatus ? agentStatusConfig[step.agentStatus] : null
  
  // 解析 JSON 字段
  const assigneeNames = parseJSON(step.assigneeNames)
  const inputs = parseJSON(step.inputs)
  const outputs = parseJSON(step.outputs)
  const skills = parseJSON(step.skills)

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
                className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
              >
                <span>📎</span>
                <span>{att.name}</span>
              </a>
            ))}
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

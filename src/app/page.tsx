'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Navbar } from '@/components/Navbar'
import Link from 'next/link'

// 任务类型
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
}

// 优先级配置
const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: '低', color: 'bg-gray-100 text-gray-600' },
  medium: { label: '中', color: 'bg-blue-100 text-blue-600' },
  high: { label: '高', color: 'bg-orange-100 text-orange-600' },
  urgent: { label: '紧急', color: 'bg-red-100 text-red-600' }
}

// 任务卡片组件
function TaskCard({ task }: { task: Task }) {
  const priority = priorityConfig[task.priority] || priorityConfig.medium

  return (
    <Link href={`/tasks/${task.id}`} className="block bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs px-2 py-1 rounded-full ${priority.color}`}>
          {priority.label}优先级
        </span>
        {task.dueDate && (
          <span className="text-xs text-gray-400">
            截止 {new Date(task.dueDate).toLocaleDateString('zh-CN')}
          </span>
        )}
      </div>
      
      <h3 className="font-semibold text-gray-900 mb-2">{task.title}</h3>
      {task.description && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">{task.description}</p>
      )}
      
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {task.assignee && (
            <div className="flex items-center space-x-1">
              <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white text-xs">
                {task.assignee.name?.[0] || '?'}
              </div>
              <span className="text-xs text-gray-500">{task.assignee.name}</span>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {new Date(task.createdAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </Link>
  )
}

// 看板列组件
function BoardColumn({ 
  title, 
  status, 
  tasks, 
  color 
}: { 
  title: string
  status: string
  tasks: Task[]
  color: string 
}) {
  const filteredTasks = tasks.filter(t => t.status === status)
  
  return (
    <div className="flex-1 min-w-[280px]">
      <div className={`flex items-center space-x-2 mb-4 pb-2 border-b-2 ${color}`}>
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
          {filteredTasks.length}
        </span>
      </div>
      <div className="space-y-3">
        {filteredTasks.map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
        {filteredTasks.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            暂无任务
          </div>
        )}
      </div>
    </div>
  )
}

// Agent 状态卡片
function AgentStatusCard({ tasks }: { tasks: Task[] }) {
  const todoCount = tasks.filter(t => t.status === 'todo').length
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length
  const doneCount = tasks.filter(t => t.status === 'done').length

  return (
    <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-6 text-white mb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="text-5xl">🦞</div>
          <div>
            <h2 className="text-xl font-bold">Lobster 已就位</h2>
            <p className="text-orange-100 text-sm mt-1">
              你的专属 Agent，随时准备帮你处理协作任务
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold">{tasks.length}</div>
          <div className="text-orange-100 text-sm">协作点追踪中</div>
        </div>
      </div>
      
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold">{todoCount}</div>
          <div className="text-xs text-orange-100">待处理</div>
        </div>
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold">{inProgressCount}</div>
          <div className="text-xs text-orange-100">进行中</div>
        </div>
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold">{doneCount}</div>
          <div className="text-xs text-orange-100">已完成</div>
        </div>
      </div>
    </div>
  )
}

// 主页
export default function Home() {
  const { data: session, status } = useSession()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  // 获取任务
  useEffect(() => {
    if (session) {
      fetchTasks()
    } else if (status === 'unauthenticated') {
      setLoading(false)
    }
  }, [session, status])

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/my/tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (e) {
      console.error('获取任务失败', e)
    } finally {
      setLoading(false)
    }
  }

  // 未登录状态
  if (status === 'unauthenticated') {
    return (
      <>
        <Navbar />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center">
          <div className="text-6xl mb-6">🤝</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">TeamAgent</h1>
          <p className="text-gray-600 mb-8">
            多智能体协作平台 — 让你的 Agent 帮你处理协作任务
          </p>
          <div className="flex justify-center space-x-4">
            <Link
              href="/login"
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl hover:from-orange-600 hover:to-red-600 transition"
            >
              注册
            </Link>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Agent 状态 */}
        <AgentStatusCard tasks={tasks} />
        
        {/* 项目标题 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">📋 我的任务看板</h2>
            <p className="text-gray-500 text-sm mt-1">
              追踪所有协作点，让 Agent 帮你协调推进
              {session?.user && (
                <span className="ml-2 text-green-600">
                  · 欢迎回来，{session.user.name || session.user.email}！
                </span>
              )}
            </p>
          </div>
          <Link
            href="/tasks/new"
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition text-sm"
          >
            ➕ 创建任务
          </Link>
        </div>
        
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : (
          /* 看板 */
          <div className="flex space-x-6 overflow-x-auto pb-4">
            <BoardColumn 
              title="待处理" 
              status="todo" 
              tasks={tasks} 
              color="border-gray-300"
            />
            <BoardColumn 
              title="进行中" 
              status="in_progress" 
              tasks={tasks} 
              color="border-blue-500"
            />
            <BoardColumn 
              title="待审核" 
              status="review" 
              tasks={tasks} 
              color="border-yellow-500"
            />
            <BoardColumn 
              title="已完成" 
              status="done" 
              tasks={tasks} 
              color="border-green-500"
            />
          </div>
        )}
      </main>
    </>
  )
}

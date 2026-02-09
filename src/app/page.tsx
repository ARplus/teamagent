'use client'

import { useState } from 'react'
import { sampleTasks, sampleAgents, sampleUsers, categoryLabels, statusLabels, priorityLabels } from '@/data/sample-data'
import { Task } from '@/lib/types'

// 获取 Agent 信息
function getAgent(agentId?: string) {
  return sampleAgents.find(a => a.id === agentId)
}

// 获取用户信息
function getUser(userId?: string) {
  return sampleUsers.find(u => u.id === userId)
}

// 任务卡片组件
function TaskCard({ task }: { task: Task }) {
  const agent = getAgent(task.agentId)
  const user = getUser(task.assigneeId)
  const category = categoryLabels[task.category]
  const priority = priorityLabels[task.priority]

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 card-hover cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs px-2 py-1 rounded-full ${category.color}`}>
          {category.label}
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${priority.color}`}>
          {priority.label}优先级
        </span>
      </div>
      
      <h3 className="font-semibold text-gray-900 mb-2">{task.title}</h3>
      <p className="text-sm text-gray-600 mb-4 line-clamp-2">{task.description}</p>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {user && (
            <div className="flex items-center space-x-1">
              <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white text-xs">
                {user.name[0]}
              </div>
              <span className="text-xs text-gray-500">{user.name}</span>
            </div>
          )}
          {agent && (
            <div className="flex items-center space-x-1 bg-gray-50 px-2 py-1 rounded-full">
              <span className="text-sm">{agent.emoji}</span>
              <span className="text-xs text-gray-600">{agent.name}</span>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {new Date(task.updatedAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </div>
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
function AgentStatusCard() {
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
          <div className="text-3xl font-bold">{sampleTasks.length}</div>
          <div className="text-orange-100 text-sm">协作点追踪中</div>
        </div>
      </div>
      
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold">{sampleTasks.filter(t => t.status === 'todo').length}</div>
          <div className="text-xs text-orange-100">待处理</div>
        </div>
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold">{sampleTasks.filter(t => t.status === 'in-progress').length}</div>
          <div className="text-xs text-orange-100">进行中</div>
        </div>
        <div className="bg-white/20 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold">{sampleTasks.filter(t => t.status === 'done').length}</div>
          <div className="text-xs text-orange-100">已完成</div>
        </div>
      </div>
    </div>
  )
}

// 团队 Agent 概览
function TeamAgents() {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">🤖 协作团队 & Agents</h2>
      <div className="grid grid-cols-3 gap-4">
        {sampleUsers.map(user => {
          const agent = getAgent(user.agentId)
          return (
            <div key={user.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-bold">
                {user.name[0]}
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-800">{user.name}</div>
                {agent && (
                  <div className="flex items-center space-x-1 text-sm text-gray-500">
                    <span>{agent.emoji}</span>
                    <span>{agent.name}</span>
                    <span className={`w-2 h-2 rounded-full ${agent.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 主页
export default function Home() {
  const [tasks] = useState(sampleTasks)

  return (
    <div>
      {/* Agent 状态 */}
      <AgentStatusCard />
      
      {/* 团队概览 */}
      <TeamAgents />
      
      {/* 项目标题 */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">📋 北大医疗康复项目 - 协作看板</h2>
        <p className="text-gray-500 text-sm mt-1">
          追踪所有协作点，让 Agent 帮你协调推进
        </p>
      </div>
      
      {/* 看板 */}
      <div className="flex space-x-6 overflow-x-auto pb-4">
        <BoardColumn 
          title="待处理" 
          status="todo" 
          tasks={tasks} 
          color="border-gray-300"
        />
        <BoardColumn 
          title="进行中" 
          status="in-progress" 
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
    </div>
  )
}

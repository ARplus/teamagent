'use client'

import { useState, useEffect } from 'react'
import AgentStatusBadge from './AgentStatusBadge'

/**
 * Agent 状态列表组件
 * 显示工作区内所有成员的 Agent 在线状态
 */

interface Agent {
  id: string
  name: string
  avatar: string | null
  status: string
  isActive: boolean
  lastSeenText: string
}

interface WorkspaceMember {
  userId: string
  userName: string
  userImage: string | null
  role: string
  agent: Agent | null
}

interface AgentStatusListProps {
  workspaceId: string
  compact?: boolean
  refreshInterval?: number // 毫秒
}

export default function AgentStatusList({
  workspaceId,
  compact = false,
  refreshInterval = 30000 // 默认30秒刷新
}: AgentStatusListProps) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [stats, setStats] = useState({ total: 0, online: 0, withAgent: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAgents = async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`)
      if (!res.ok) throw new Error('获取失败')
      const data = await res.json()
      setMembers(data.agents)
      setStats(data.stats)
      setError(null)
    } catch (err) {
      setError('加载 Agent 状态失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAgents()
    
    // 定时刷新
    const interval = setInterval(fetchAgents, refreshInterval)
    return () => clearInterval(interval)
  }, [workspaceId, refreshInterval])

  if (loading) {
    return (
      <div className="animate-pulse p-4">
        <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 bg-gray-100 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-red-500 text-sm">
        {error}
        <button 
          onClick={fetchAgents}
          className="ml-2 text-blue-500 hover:underline"
        >
          重试
        </button>
      </div>
    )
  }

  // 紧凑模式：只显示统计
  if (compact) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="text-gray-600">{stats.online} 在线</span>
        </span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-500">{stats.total} 成员</span>
      </div>
    )
  }

  // 完整模式
  return (
    <div className="bg-white rounded-lg border p-4">
      {/* 标题和统计 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">团队 Agent</h3>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            {stats.online}
          </span>
          <span>/</span>
          <span>{stats.withAgent}</span>
        </div>
      </div>

      {/* 成员列表 */}
      <div className="space-y-2">
        {members.map(member => (
          <div 
            key={member.userId}
            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              {/* 头像 */}
              <div className="relative">
                {member.userImage ? (
                  <img 
                    src={member.userImage} 
                    alt={member.userName}
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium">
                    {member.userName[0]}
                  </div>
                )}
                {/* 在线指示器 */}
                {member.agent?.isActive && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
                )}
              </div>

              {/* 名字和 Agent */}
              <div>
                <div className="font-medium text-gray-800 text-sm">
                  {member.userName}
                </div>
                <div className="text-xs text-gray-400">
                  {member.agent ? member.agent.name : '无 Agent'}
                </div>
              </div>
            </div>

            {/* 状态 */}
            <div className="flex items-center gap-2">
              {member.agent ? (
                <>
                  <AgentStatusBadge 
                    status={member.agent.status}
                    isActive={member.agent.isActive}
                    size="sm"
                  />
                  {!member.agent.isActive && (
                    <span className="text-xs text-gray-400">
                      {member.agent.lastSeenText}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 离线预警 */}
      {stats.withAgent > 0 && stats.online === 0 && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-700 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>所有 Agent 都离线了！任务无法自动执行。</span>
          </div>
        </div>
      )}
    </div>
  )
}

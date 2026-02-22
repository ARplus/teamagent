'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

// ============ Types ============

interface AgentEntry {
  agent: {
    id: string
    name: string
    personality: string | null
    avatar: string | null
    status: string
    capabilities: string | null
    reputation: number | null
    claimedAt: string | null
  }
  user: {
    id: string
    name: string | null
    email: string
  }
  stats: {
    doneSteps: number
    pendingSteps: number
  }
  isCurrentUser: boolean
}

// ============ Utils ============

function parseCapabilities(cap: string | null): string[] {
  if (!cap) return []
  try {
    const parsed = JSON.parse(cap)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const statusMap: Record<string, { dot: string; label: string; color: string }> = {
  online:  { dot: 'bg-emerald-500', label: '在线',   color: 'text-emerald-600' },
  working: { dot: 'bg-blue-500',    label: '工作中', color: 'text-blue-600'    },
  waiting: { dot: 'bg-amber-500',   label: '等待中', color: 'text-amber-600'   },
  offline: { dot: 'bg-slate-400',   label: '离线',   color: 'text-slate-500'   },
}

// 渐变色池（按 agent.id 的 hash 选）
const gradients = [
  'from-orange-500 via-rose-500 to-pink-500',
  'from-violet-500 via-purple-500 to-indigo-500',
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-blue-500 via-indigo-500 to-violet-500',
  'from-amber-500 via-orange-500 to-red-500',
  'from-pink-500 via-rose-500 to-red-500',
  'from-teal-500 via-cyan-500 to-sky-500',
]

function pickGradient(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff
  }
  return gradients[Math.abs(hash) % gradients.length]
}

// ============ Agent Card ============

function AgentCard({ entry, onClick }: { entry: AgentEntry; onClick: () => void }) {
  const { agent, user, stats, isCurrentUser } = entry
  const capabilities = parseCapabilities(agent.capabilities)
  const statusInfo = statusMap[agent.status] ?? statusMap.offline
  const gradient = pickGradient(agent.id)

  return (
    <div
      onClick={onClick}
      className="group relative bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden cursor-pointer hover:shadow-xl hover:shadow-orange-500/10 hover:-translate-y-1 transition-all duration-300"
    >
      {/* 顶部渐变头像区 */}
      <div className={`relative h-28 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        {/* 装饰圆 */}
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white/10 rounded-full" />

        {agent.avatar ? (
          <img
            src={agent.avatar}
            alt={agent.name}
            className="relative w-20 h-20 rounded-2xl object-cover shadow-xl border-4 border-white/30"
          />
        ) : (
          <div className="relative w-20 h-20 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-3xl font-bold text-white shadow-xl border-4 border-white/30">
            {agent.name.charAt(0)}
          </div>
        )}

        {/* 自己的标签 */}
        {isCurrentUser && (
          <div className="absolute top-3 left-3 bg-white/20 backdrop-blur text-white text-xs px-2 py-0.5 rounded-full font-medium border border-white/30">
            我的
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="p-5">
        {/* 名字 + 状态灯 */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-slate-900 truncate">{agent.name}</h3>
          <div className="flex items-center space-x-1.5 flex-shrink-0 ml-2">
            <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
            <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
          </div>
        </div>

        {/* 用户名 */}
        <div className="text-xs text-slate-400 mb-3 truncate">
          {user.name || user.email}
        </div>

        {/* 能力标签 */}
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {capabilities.slice(0, 4).map((cap, i) => (
              <span
                key={i}
                className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-lg font-medium"
              >
                {cap}
              </span>
            ))}
            {capabilities.length > 4 && (
              <span className="bg-slate-100 text-slate-400 text-xs px-2 py-0.5 rounded-lg">
                +{capabilities.length - 4}
              </span>
            )}
          </div>
        )}

        {/* 步骤统计 */}
        <div className="flex items-center space-x-4 pt-3 border-t border-slate-50">
          <div className="flex items-center space-x-1.5">
            <span className="text-base">✅</span>
            <span className="text-sm font-semibold text-slate-800">{stats.doneSteps}</span>
            <span className="text-xs text-slate-400">已完成</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-base">🔄</span>
            <span className="text-sm font-semibold text-slate-800">{stats.pendingSteps}</span>
            <span className="text-xs text-slate-400">进行中</span>
          </div>
          {agent.reputation !== null && agent.reputation !== undefined && (
            <div className="flex items-center space-x-1 ml-auto">
              <span className="text-amber-400 text-sm">★</span>
              <span className="text-xs font-medium text-slate-600">{(agent.reputation ?? 0).toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Hover 箭头 */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-7 h-7 bg-white/80 backdrop-blur rounded-full flex items-center justify-center shadow text-slate-600 text-sm">
          →
        </div>
      </div>
    </div>
  )
}

// ============ Empty State ============

function EmptyState({ onPair }: { onPair: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <div className="w-28 h-28 bg-gradient-to-br from-slate-200 to-slate-300 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-inner">
        🌊
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">战队还是空的</h2>
      <p className="text-slate-500 mb-8 text-center max-w-sm">
        工作区里还没有 Agent 出现过。先去配对一个，让它开始执行任务吧！
      </p>
      <button
        onClick={onPair}
        className="flex items-center space-x-2 px-8 py-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-2xl font-semibold text-lg shadow-xl shadow-orange-500/30 hover:from-orange-400 hover:to-rose-400 transition-all"
      >
        <span>⊕</span>
        <span>去配对 Agent</span>
      </button>
    </div>
  )
}

// ============ Main Page ============

export default function AgentsTeamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    if (status === 'authenticated') {
      fetch('/api/agents/team')
        .then(r => r.json())
        .then(data => {
          setAgents(data.agents ?? [])
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [status, router])

  if (status === 'loading' || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🌊</div>
          <div className="text-slate-500 text-sm">加载战队中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* 标题区 */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            🌊 我的战队
          </h1>
          <p className="text-slate-500 text-lg">深海无声，代码不停</p>
          {agents.length > 0 && (
            <div className="mt-3 text-sm text-slate-400">
              共 {agents.length} 位 Agent 战友
            </div>
          )}
        </div>

        {/* 空状态 */}
        {agents.length === 0 && (
          <EmptyState onPair={() => router.push('/agent')} />
        )}

        {/* Agent 卡片 Grid */}
        {agents.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map(entry => (
              <AgentCard
                key={entry.agent.id}
                entry={entry}
                onClick={() => router.push(`/agent/${entry.agent.id}`)}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

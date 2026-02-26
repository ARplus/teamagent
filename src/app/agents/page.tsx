'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

// ============ Types ============

interface Commander {
  id: string
  name: string | null
  email: string
  avatar: string | null
  createdAt: string
}

interface AgentData {
  id: string
  name: string
  personality: string | null
  avatar: string | null
  status: string
  capabilities: string | null
  reputation: number | null
  claimedAt: string | null
  isMainAgent: boolean
  userId?: string
  userName?: string | null
  userEmail?: string
  stats: {
    doneSteps: number
    pendingSteps: number
  }
}

interface TeamData {
  commander: Commander
  mainAgent: AgentData | null
  subAgents: AgentData[]
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

const avatarColors = [
  'from-orange-400 to-rose-500',
  'from-blue-400 to-indigo-500',
  'from-violet-400 to-purple-500',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-500',
  'from-cyan-400 to-blue-500',
  'from-fuchsia-400 to-rose-500',
  'from-teal-400 to-emerald-500',
  'from-indigo-400 to-violet-500',
  'from-pink-400 to-fuchsia-500',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

function extractAvatar(name: string, avatar: string | null): string {
  if (avatar?.trim()) return avatar.trim()
  const m = name.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u)
  if (m) return m[0]
  if (name.toLowerCase().includes('lobster')) return '🦞'
  return name.charAt(0).toUpperCase()
}

function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

function getStatusInfo(status: string): { dot: string; label: string } {
  const map: Record<string, { dot: string; label: string }> = {
    online:  { dot: 'bg-emerald-400', label: '在线' },
    working: { dot: 'bg-blue-400',    label: '工作中' },
    waiting: { dot: 'bg-amber-400',   label: '等待中' },
    offline: { dot: 'bg-slate-400',   label: '离线' },
  }
  return map[status] ?? map.offline
}

// ============ Commander Card ============

function CommanderCard({ commander }: { commander: Commander }) {
  const initial = (commander.name || commander.email).charAt(0).toUpperCase()

  return (
    <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute -top-10 -right-10 w-48 h-48 bg-orange-500/10 rounded-full blur-2xl" />
      <div className="absolute -bottom-8 -left-8 w-40 h-40 bg-rose-500/10 rounded-full blur-xl" />

      {/* 右上角标题 */}
      <div className="absolute top-4 right-5 text-orange-400 text-xs font-semibold tracking-widest uppercase opacity-80">
        🌊 我的数字军团
      </div>

      <div className="relative flex items-center space-x-5">
        {/* 头像 */}
        <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-2xl font-bold text-white shadow-xl shadow-orange-500/30">
          {commander.avatar ? (
            <img src={commander.avatar} alt="" className="w-full h-full rounded-2xl object-cover" />
          ) : (
            initial
          )}
        </div>

        {/* 信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-3 mb-1.5">
            <h2 className="text-white text-xl font-bold truncate">
              {commander.name || commander.email.split('@')[0]}
            </h2>
            <span className="flex-shrink-0 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
              👑 总司令
            </span>
          </div>
          <p className="text-white/50 text-sm">
            数字军团创始人 · 自 {formatJoinDate(commander.createdAt)} 起
          </p>
        </div>
      </div>
    </div>
  )
}

// ============ Main Agent Card ============

function MainAgentCard({ agent }: { agent: AgentData }) {
  const capabilities = parseCapabilities(agent.capabilities)
  const statusInfo = getStatusInfo(agent.status)
  const avatarIcon = extractAvatar(agent.name, agent.avatar)
  const displayName = agent.name.replace(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u, '')
  const reputation = agent.reputation ?? 0
  const reputationStars = Math.round(reputation)

  return (
    <div className="relative bg-gradient-to-br from-orange-500 to-rose-500 rounded-2xl p-6 overflow-hidden shadow-2xl shadow-orange-500/30">
      {/* 装饰圆 */}
      <div className="absolute -top-12 -right-12 w-52 h-52 bg-white/10 rounded-full" />
      <div className="absolute -bottom-8 -left-8 w-36 h-36 bg-white/5 rounded-full" />
      <div className="absolute top-1/2 right-8 w-24 h-24 bg-white/5 rounded-full" />

      {/* 总指挥 badge */}
      <div className="relative flex items-center justify-between mb-5">
        <span className="bg-white/20 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full font-semibold border border-white/20">
          ⚡ 总指挥
        </span>
        {/* 信誉星 */}
        <div className="flex items-center space-x-1">
          {Array.from({ length: Math.max(1, reputationStars) }).map((_, i) => (
            <span key={i} className="text-yellow-300 text-sm">⭐</span>
          ))}
          {reputation > 0 && (
            <span className="text-white/70 text-xs ml-1">{reputation.toFixed(1)}</span>
          )}
        </div>
      </div>

      {/* 头像 + 状态 */}
      <div className="relative flex items-center space-x-4 mb-5">
        <div className="flex-shrink-0 w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-5xl text-white shadow-xl border-2 border-white/30">
          {agent.avatar ? (
            <img src={agent.avatar} alt="" className="w-full h-full rounded-2xl object-cover" />
          ) : (
            avatarIcon
          )}
        </div>
        <div>
          <h3 className="text-white text-2xl font-bold mb-1">{displayName}</h3>
          <div className="flex items-center space-x-2">
            <span className={`w-2.5 h-2.5 rounded-full ${statusInfo.dot} shadow-lg`} />
            <span className="text-white/80 text-sm font-medium">{statusInfo.label}</span>
          </div>
          {agent.personality && (
            <p className="text-white/60 text-xs mt-1 truncate max-w-[200px]">{agent.personality}</p>
          )}
        </div>
      </div>

      {/* 能力标签 */}
      {capabilities.length > 0 && (
        <div className="relative flex flex-wrap gap-2 mb-5">
          {capabilities.slice(0, 5).map((cap, i) => (
            <span
              key={i}
              className="bg-white/20 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full font-medium border border-white/20"
            >
              {cap}
            </span>
          ))}
        </div>
      )}

      {/* 战绩 */}
      <div className="relative flex items-center space-x-6 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3">
        <div className="text-center">
          <div className="text-white text-2xl font-bold">{agent.stats.doneSteps}</div>
          <div className="text-white/60 text-xs mt-0.5">步骤完成</div>
        </div>
        <div className="w-px h-8 bg-white/20" />
        <div className="text-center">
          <div className="text-white text-2xl font-bold">{agent.stats.pendingSteps}</div>
          <div className="text-white/60 text-xs mt-0.5">进行中</div>
        </div>
        {agent.claimedAt && (
          <>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-center">
              <div className="text-white text-xs font-semibold">{formatJoinDate(agent.claimedAt)}</div>
              <div className="text-white/60 text-xs mt-0.5">入伍时间</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ============ Sub Agent Card ============

function SubAgentCard({ agent, onClick }: { agent: AgentData; onClick: () => void }) {
  const capabilities = parseCapabilities(agent.capabilities)
  const statusInfo = getStatusInfo(agent.status)
  const avatarGrad = getAvatarColor(agent.name)
  const avatarIcon = extractAvatar(agent.name, agent.avatar)
  const displayName = agent.name.replace(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u, '')

  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-2xl shadow-sm border border-slate-100 p-3 cursor-pointer hover:shadow-lg hover:shadow-orange-500/10 hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* 头像 + 状态点 */}
      <div className="flex items-start justify-between mb-2">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarGrad} flex items-center justify-center text-lg shadow-sm`}>
          {avatarIcon}
        </div>
        <span className={`w-2 h-2 rounded-full mt-1 ${statusInfo.dot}`} />
      </div>

      {/* 名字 */}
      <h4 className="text-slate-900 font-bold text-xs truncate mb-1.5 leading-snug">{displayName}</h4>

      {/* 能力标签（2个，更小） */}
      {capabilities.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-2">
          {capabilities.slice(0, 2).map((cap, i) => (
            <span key={i} className="bg-slate-50 text-slate-500 text-[10px] px-1.5 py-0.5 rounded font-medium truncate max-w-full">
              {cap}
            </span>
          ))}
          {capabilities.length > 2 && (
            <span className="text-slate-300 text-[10px] px-1">+{capabilities.length - 2}</span>
          )}
        </div>
      )}

      {/* 底部：只有图标+数字 */}
      <div className="flex items-center gap-2 pt-1.5 border-t border-slate-50">
        <span className="text-[11px] text-emerald-600 font-semibold">✅ {agent.stats.doneSteps}</span>
        {agent.stats.pendingSteps > 0 && (
          <span className="text-[11px] text-blue-500">🔄 {agent.stats.pendingSteps}</span>
        )}
      </div>
    </div>
  )
}

// ============ Empty State ============

function EmptyState({ onPair }: { onPair: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-24 h-24 bg-gradient-to-br from-slate-100 to-slate-200 rounded-3xl flex items-center justify-center text-4xl mb-5 shadow-inner">
        🌊
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">还没有战队成员</h2>
      <p className="text-slate-400 text-sm mb-6 max-w-xs">
        配对你的第一个 Agent，让它加入你的数字军团！
      </p>
      <button
        onClick={onPair}
        className="px-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-semibold shadow-lg shadow-orange-500/30 hover:from-orange-400 hover:to-rose-400 transition-all"
      >
        ⊕ 配对我的第一个 Agent
      </button>
    </div>
  )
}

// ============ Main Page ============

export default function AgentsTeamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [team, setTeam] = useState<TeamData | null>(null)
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
          setTeam(data)
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [status, router])

  if (status === 'loading' || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🌊</div>
          <div className="text-slate-400 text-sm font-medium">数字军团集结中...</div>
        </div>
      </div>
    )
  }

  const hasNoAgents = !team?.mainAgent && (!team?.subAgents || team.subAgents.length === 0)

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">

        {/* ① 司令官卡 */}
        {team?.commander && (
          <CommanderCard commander={team.commander} />
        )}

        {/* 空状态 */}
        {hasNoAgents && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <EmptyState onPair={() => router.push('/agent')} />
          </div>
        )}

        {/* ② 主 Agent 大卡 */}
        {team?.mainAgent && (
          <div>
            <div
              className="cursor-pointer"
              onClick={() => router.push(`/agent/${team.mainAgent!.id}`)}
            >
              <MainAgentCard agent={team.mainAgent} />
            </div>
          </div>
        )}

        {/* ③ 子 Agent 战队 */}
        {team?.subAgents && team.subAgents.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-slate-800 font-bold text-lg">🌊 战队成员</h2>
              <span className="text-slate-400 text-sm">{team.subAgents.length} 位</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {team.subAgents.map(agent => (
                <SubAgentCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => router.push(`/agent/${agent.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ⑤ 底部分享提示 */}
        {!hasNoAgents && (
          <div className="text-center pt-4 pb-8">
            <p className="text-slate-400 text-sm">
              截图分享你的数字军团 🌊
            </p>
          </div>
        )}

      </div>
    </div>
  )
}

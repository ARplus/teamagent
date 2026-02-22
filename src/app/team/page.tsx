'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'
import { PairingModal } from '@/components/PairingModal'

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
  stats: { doneSteps: number; pendingSteps: number }
}

interface TeamData {
  commander: Commander
  mainAgent: AgentData | null
  subAgents: AgentData[]
}

// ============ Utils ============
function parseCapabilities(cap: string | null): string[] {
  if (!cap) return []
  try { const p = JSON.parse(cap); return Array.isArray(p) ? p : [] }
  catch { return [] }
}

const statusDot: Record<string, string> = {
  online: 'bg-green-400', working: 'bg-blue-400',
  waiting: 'bg-yellow-400', offline: 'bg-slate-400'
}
const statusLabel: Record<string, string> = {
  online: '在线', working: '工作中', waiting: '待命', offline: '离线'
}

const avatarGradients = [
  'from-orange-400 to-rose-500',
  'from-blue-400 to-purple-500',
  'from-green-400 to-teal-500',
  'from-yellow-400 to-orange-500',
  'from-pink-400 to-rose-500',
  'from-indigo-400 to-blue-500',
  'from-teal-400 to-cyan-500',
]
function agentGradient(name: string) {
  return avatarGradients[name.charCodeAt(0) % avatarGradients.length]
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  if (months > 0) return `${months}个月前`
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days > 0) return `${days}天前`
  return '今天'
}

// ============ AgentRow ============
function AgentRow({ agent, isMain }: { agent: AgentData; isMain?: boolean }) {
  const caps = parseCapabilities(agent.capabilities).slice(0, 3)
  const dot = statusDot[agent.status] || statusDot.offline
  const label = statusLabel[agent.status] || '离线'
  const grad = agentGradient(agent.name)
  const total = agent.stats.doneSteps + agent.stats.pendingSteps
  const pct = total > 0 ? Math.round((agent.stats.doneSteps / total) * 100) : 0

  return (
    <div className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors group ${isMain ? 'bg-orange-50/50' : ''}`}>
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
        {agent.avatar || agent.name.charAt(0).toUpperCase()}
      </div>

      {/* Name + badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 text-sm">{agent.name}</span>
          {isMain && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium border border-orange-200">
              ⚡ 总指挥
            </span>
          )}
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          <span className="text-xs text-slate-400">{label}</span>
        </div>
        {agent.personality && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{agent.personality}</p>
        )}
      </div>

      {/* Capabilities */}
      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
        {caps.map(c => (
          <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{c}</span>
        ))}
      </div>

      {/* Progress bar */}
      <div className="hidden lg:flex flex-col items-end gap-1 w-28 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="text-green-600 font-medium">✅ {agent.stats.doneSteps}</span>
          <span>·</span>
          <span className="text-blue-500">🔄 {agent.stats.pendingSteps}</span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-400 to-rose-400 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Reputation */}
      <div className="hidden md:flex items-center gap-0.5 flex-shrink-0 w-16 justify-end">
        {agent.reputation ? (
          <>
            <span className="text-yellow-400 text-sm">⭐</span>
            <span className="text-xs font-medium text-slate-600">{agent.reputation.toFixed(1)}</span>
          </>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </div>
    </div>
  )
}

// ============ EditProfileModal ============
function EditProfileModal({
  commander,
  onClose,
  onSaved,
}: {
  commander: Commander
  onClose: () => void
  onSaved: (name: string, title: string, mission: string) => void
}) {
  const [name, setName] = useState(commander.name || '')
  const [title, setTitle] = useState('数字军团总司令')
  const [mission, setMission] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, nickname: title })
      })
      onSaved(name, title, mission)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-800 mb-4">✏️ 编辑个人资料</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-600 mb-1 block">显示名称</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400/50 focus:border-orange-400" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 mb-1 block">头衔</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400/50 focus:border-orange-400" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 mb-1 block">使命宣言</label>
            <textarea value={mission} onChange={e => setMission(e.target.value)}
              placeholder="你的数字公司要做什么？"
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-orange-400/50 focus:border-orange-400" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-medium">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold hover:from-orange-400 hover:to-rose-400 disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============ Main Page ============
export default function TeamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPairing, setShowPairing] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profileTitle, setProfileTitle] = useState('数字军团总司令')
  const [profileMission, setProfileMission] = useState('')

  // Live status overlay
  const [liveStatus, setLiveStatus] = useState<string>('online')

  useEffect(() => {
    if (session) fetchTeam()
    else if (status === 'unauthenticated') router.push('/login')
  }, [session, status])

  useEffect(() => {
    fetch('/api/agent/status').then(r => r.json()).then(d => setLiveStatus(d.status || 'online')).catch(() => {})
  }, [])

  const fetchTeam = async () => {
    try {
      const res = await fetch('/api/agents/team')
      if (res.ok) {
        const json: TeamData = await res.json()
        setData(json)
        setProfileName(json.commander.name)
      }
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="text-5xl mb-3 animate-bounce">🌊</div>
          <div className="text-slate-500 text-sm">加载战队数据...</div>
        </div>
      </div>
    )
  }

  const commander = data?.commander
  const mainAgent = data?.mainAgent
  const subAgents = data?.subAgents ?? []
  const allAgents = mainAgent ? [mainAgent, ...subAgents] : subAgents
  const totalDone = allAgents.reduce((s, a) => s + a.stats.doneSteps, 0)
  const totalPending = allAgents.reduce((s, a) => s + a.stats.pendingSteps, 0)
  const displayName = profileName || commander?.name || commander?.email || 'Commander'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      {/* ── Hero Banner ── */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
        {/* decorative blobs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl -translate-y-1/2" />
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl -translate-y-1/2" />

        <div className="max-w-6xl mx-auto px-6 py-10 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              {/* Commander avatar */}
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-orange-500/30 flex-shrink-0">
                {initials}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-white">{displayName}</h1>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-medium">
                    👑 总司令
                  </span>
                </div>
                {profileMission ? (
                  <p className="text-slate-400 text-sm">{profileMission}</p>
                ) : (
                  <p className="text-slate-500 text-sm italic">
                    「深海无声，代码不停」— 点击编辑填写你的使命宣言
                  </p>
                )}
                <p className="text-slate-600 text-xs mt-1">
                  数字军团创始人 · {commander ? `自 ${new Date(commander.createdAt).getFullYear()}年${new Date(commander.createdAt).getMonth() + 1}月起` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEdit(true)}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 text-sm transition flex items-center gap-2"
              >
                ✏️ 编辑资料
              </button>
              <button
                onClick={() => setShowPairing(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white text-sm font-semibold shadow-lg shadow-orange-500/25 transition flex items-center gap-2"
              >
                + 招募成员
              </button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-4 mt-8 pt-8 border-t border-slate-800">
            {[
              { label: 'Agent 成员', value: allAgents.length, unit: '位', icon: '🤖' },
              { label: '已完成步骤', value: totalDone, unit: '步', icon: '✅' },
              { label: '进行中', value: totalPending, unit: '步', icon: '🔄' },
              { label: '在线成员', value: allAgents.filter(a => a.status === 'online' || a.status === 'working').length, unit: '位', icon: '🟢' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold text-white">{s.icon} {s.value}<span className="text-sm font-normal text-slate-400 ml-1">{s.unit}</span></div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-8">

          {/* ── Left: Commander Profile Card ── */}
          <div className="w-64 flex-shrink-0 space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-5 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3 shadow-lg">
                  {initials}
                </div>
                <div className="text-white font-bold">{displayName}</div>
                <div className="text-slate-400 text-xs mt-1">{profileTitle}</div>
                <div className="mt-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                    👑 总司令
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>邮箱</span>
                  <span className="text-slate-700 truncate ml-2 max-w-[120px]">{commander?.email}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>创建于</span>
                  <span className="text-slate-700">{commander ? new Date(commander.createdAt).toLocaleDateString('zh-CN') : '-'}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>战队规模</span>
                  <span className="text-slate-700">{allAgents.length} 位成员</span>
                </div>
                <button
                  onClick={() => setShowEdit(true)}
                  className="w-full mt-2 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 text-xs font-medium transition"
                >
                  ✏️ 编辑资料
                </button>
              </div>
            </div>

            {/* Quick links */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">快捷操作</div>
              {[
                { icon: '📋', label: '查看所有任务', href: '/' },
                { icon: '🤖', label: '我的 Agent', href: '/agent' },
                { icon: '🌐', label: '官网首页', href: '/landing' },
              ].map(l => (
                <a key={l.href} href={l.href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-800 text-sm transition">
                  <span>{l.icon}</span><span>{l.label}</span>
                </a>
              ))}
            </div>
          </div>

          {/* ── Right: Agent Team Table ── */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              {/* Table header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="font-bold text-slate-800">🌊 Agent 战队</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{allAgents.length} 位成员 · {allAgents.filter(a => a.status !== 'offline').length} 在线</p>
                </div>
                <button
                  onClick={() => setShowPairing(true)}
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white text-sm font-semibold rounded-xl shadow-md shadow-orange-500/20 transition flex items-center gap-1.5"
                >
                  <span>+</span><span>招募成员</span>
                </button>
              </div>

              {/* Column labels */}
              <div className="flex items-center gap-4 px-5 py-2 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-400 uppercase tracking-wide">
                <div className="w-10 flex-shrink-0" />
                <div className="flex-1">成员</div>
                <div className="hidden md:block w-40">技能</div>
                <div className="hidden lg:block w-28 text-right">完成 / 进行</div>
                <div className="hidden md:block w-16 text-right">信誉</div>
              </div>

              {/* Agent rows */}
              {allAgents.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="text-4xl mb-3">🌊</div>
                  <p className="text-slate-500 text-sm">还没有 Agent 战队成员</p>
                  <button onClick={() => setShowPairing(true)}
                    className="mt-4 px-5 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold">
                    配对第一位成员
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {mainAgent && <AgentRow agent={{ ...mainAgent, status: liveStatus }} isMain />}
                  {subAgents.map(a => <AgentRow key={a.id} agent={a} />)}
                </div>
              )}

              {/* Footer hint */}
              {allAgents.length > 0 && (
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-center">
                  <p className="text-xs text-slate-400">截图分享你的数字军团 🌊 · TeamAgent</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPairing && <PairingModal onClose={() => setShowPairing(false)} />}
      {showEdit && commander && (
        <EditProfileModal
          commander={commander}
          onClose={() => setShowEdit(false)}
          onSaved={(name, title, mission) => {
            setProfileName(name)
            setProfileTitle(title)
            setProfileMission(mission)
          }}
        />
      )}
    </div>
  )
}

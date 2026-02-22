'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'
import { PairingModal } from '@/components/PairingModal'

// ============ Types ============
interface Commander {
  id: string; name: string | null; email: string; avatar: string | null; createdAt: string
}
interface AgentData {
  id: string; name: string; personality: string | null; avatar: string | null
  status: string; capabilities: string | null; reputation: number | null
  claimedAt: string | null; isMainAgent: boolean; userId?: string; userName?: string | null
  stats: { doneSteps: number; pendingSteps: number }
}
interface TaskStats {
  inProgressTasks: number; doneTasks: number
  soloTasks: number; teamTasks: number
  totalAgentMs: number; totalHumanMs: number
}
interface TeamData {
  commander: Commander; mainAgent: AgentData | null
  subAgents: AgentData[]; taskStats: TaskStats
}

// ============ Utils ============
function parseCaps(cap: string | null): string[] {
  if (!cap) return []
  try { const p = JSON.parse(cap); return Array.isArray(p) ? p : [] } catch { return [] }
}
const statusDot: Record<string, string> = {
  online: 'bg-green-400', working: 'bg-blue-400', waiting: 'bg-yellow-400', offline: 'bg-slate-400'
}
const statusLabel: Record<string, string> = {
  online: '在线', working: '工作中', waiting: '待命', offline: '离线'
}
const gradients = [
  'from-orange-400 to-rose-500','from-blue-400 to-purple-500',
  'from-green-400 to-teal-500','from-yellow-400 to-orange-500',
  'from-pink-400 to-rose-500','from-indigo-400 to-blue-500','from-teal-400 to-cyan-500',
]
const grad = (name: string) => gradients[name.charCodeAt(0) % gradients.length]

// Extract emoji from agent name, fallback to first letter
function agentAvatar(name: string): string {
  const match = name.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u)
  return match ? match[0] : name.charAt(0).toUpperCase()
}

function msToHours(ms: number) {
  const h = Math.round(ms / 3600000)
  return h > 0 ? `${h}小时` : `${Math.round(ms / 60000)}分钟`
}

// ============ AgentRow (sub-agent) ============
function AgentRow({ agent }: { agent: AgentData }) {
  const caps = parseCaps(agent.capabilities).slice(0, 2)
  const total = agent.stats.doneSteps + agent.stats.pendingSteps
  const pct = total > 0 ? Math.round((agent.stats.doneSteps / total) * 100) : 0
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad(agent.name)} flex items-center justify-center text-white font-bold text-base flex-shrink-0`}>
        {agentAvatar(agent.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 text-sm">{agent.name}</span>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[agent.status] || statusDot.offline}`} />
          <span className="text-xs text-slate-400">{statusLabel[agent.status] || '离线'}</span>
        </div>
        {agent.personality && <p className="text-xs text-slate-400 truncate mt-0.5">{agent.personality}</p>}
      </div>
      <div className="hidden md:flex gap-1.5 flex-shrink-0">
        {caps.map(c => <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{c}</span>)}
      </div>
      <div className="hidden lg:flex flex-col items-end gap-1 w-24 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-600 font-medium">✅ {agent.stats.doneSteps}</span>
          <span className="text-slate-300">·</span>
          <span className="text-blue-500">🔄 {agent.stats.pendingSteps}</span>
        </div>
        <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-orange-400 to-rose-400 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {agent.reputation
        ? <div className="hidden md:flex items-center gap-0.5 w-12 justify-end flex-shrink-0"><span className="text-yellow-400 text-xs">⭐</span><span className="text-xs font-medium text-slate-600">{agent.reputation.toFixed(1)}</span></div>
        : <div className="hidden md:block w-12 text-right text-slate-300 text-xs flex-shrink-0">—</div>
      }
    </div>
  )
}

// ============ Main Agent Card (left panel) ============
function MainAgentCard({ agent, liveStatus }: { agent: AgentData; liveStatus: string }) {
  const caps = parseCaps(agent.capabilities)
  const dot = statusDot[liveStatus] || statusDot.offline
  const label = statusLabel[liveStatus] || '离线'
  const total = agent.stats.doneSteps + agent.stats.pendingSteps
  const pct = total > 0 ? Math.round((agent.stats.doneSteps / total) * 100) : 0

  return (
    <div className="rounded-2xl overflow-hidden shadow-md shadow-orange-500/10 border border-orange-100">
      <div className="bg-gradient-to-br from-orange-500 to-rose-500 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs px-2.5 py-1 rounded-full bg-white/20 text-white font-medium border border-white/30">
            ⚡ 总指挥
          </span>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            <span className="text-white/80 text-xs">{label}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white text-2xl font-bold border border-white/30">
            {agentAvatar(agent.name)}
          </div>
          <div>
            <div className="text-white font-bold text-lg">{agent.name}</div>
            {agent.personality && <div className="text-white/70 text-xs mt-0.5 line-clamp-2">{agent.personality}</div>}
          </div>
        </div>
        {caps.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {caps.map(c => <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-white/15 text-white border border-white/20">{c}</span>)}
          </div>
        )}
      </div>
      <div className="bg-white p-4">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="text-center p-2.5 bg-green-50 rounded-xl">
            <div className="text-xl font-bold text-green-600">{agent.stats.doneSteps}</div>
            <div className="text-xs text-slate-400">已完成</div>
          </div>
          <div className="text-center p-2.5 bg-blue-50 rounded-xl">
            <div className="text-xl font-bold text-blue-500">{agent.stats.pendingSteps}</div>
            <div className="text-xs text-slate-400">进行中</div>
          </div>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-orange-400 to-rose-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        {agent.reputation !== null && agent.reputation > 0 && (
          <div className="flex items-center justify-center gap-1 mt-3">
            {[1,2,3,4,5].map(i => (
              <span key={i} className={`text-sm ${i <= Math.round(agent.reputation ?? 0) ? 'text-yellow-400' : 'text-slate-200'}`}>★</span>
            ))}
            <span className="text-xs text-slate-500 ml-1">{(agent.reputation).toFixed(1)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Inline editable mission ============
function InlineMission({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select() } }, [editing])
  const save = () => { setEditing(false); onSave(draft) }
  if (editing) return (
    <textarea ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={save}
      className="bg-transparent text-slate-200 text-sm resize-none w-full max-w-xl outline-none border-b border-orange-400/60 pb-0.5 leading-relaxed"
      rows={3} style={{ minWidth: 320 }} />
  )
  return (
    <p onClick={() => setEditing(true)}
      className="text-slate-400 text-sm italic cursor-pointer hover:text-slate-300 transition max-w-xl leading-relaxed line-clamp-3">
      {value || '「点击填写你的使命宣言」'}
    </p>
  )
}

// ============ StatPill ============
function StatPill({ a, b, labelA, labelB, icon }: { a: number; b: number; labelA: string; labelB: string; icon: string }) {
  return (
    <div className="text-center">
      <div className="flex items-baseline justify-center gap-1">
        <span className="text-2xl font-bold text-white">{a}</span>
        <span className="text-slate-500 text-sm font-medium">/</span>
        <span className="text-lg font-semibold text-slate-400">{b}</span>
        <span className="text-xl ml-1">{icon}</span>
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{labelA} / {labelB}</div>
    </div>
  )
}

// ============ Main ============
export default function TeamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPairing, setShowPairing] = useState(false)
  const [liveStatus, setLiveStatus] = useState('online')
  const [mission, setMission] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')

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
      if (res.ok) { const d: TeamData = await res.json(); setData(d); setNameValue(d.commander.name || '') }
    } finally { setLoading(false) }
  }

  const saveName = async () => {
    setEditingName(false)
    await fetch('/api/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameValue }) })
  }

  const saveMission = async (v: string) => {
    setMission(v)
    await fetch('/api/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: v }) })
  }

  if (status === 'loading' || loading) return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center"><div className="text-5xl mb-3 animate-bounce">🌊</div><div className="text-slate-500 text-sm">加载战队...</div></div>
    </div>
  )

  const c = data?.commander
  const mainAgent = data?.mainAgent
  const subAgents = data?.subAgents ?? []
  const ts = data?.taskStats
  const allAgents = mainAgent ? [mainAgent, ...subAgents] : subAgents
  const onlineCount = allAgents.filter(a => a.status !== 'offline').length
  const totalMs = (ts?.totalAgentMs ?? 0) + (ts?.totalHumanMs ?? 0)
  const initials = (nameValue || c?.name || '?').charAt(0).toUpperCase()
  const displayName = nameValue || c?.name || c?.email || 'Commander'

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      {/* ── Hero Banner ── */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/8 rounded-full blur-3xl -translate-y-1/2" />
          <div className="absolute top-0 right-1/3 w-80 h-80 bg-rose-500/8 rounded-full blur-3xl -translate-y-1/2" />
        </div>

        <div className="max-w-6xl mx-auto px-6 py-8 relative">
          {/* Top row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-orange-500/30 flex-shrink-0">
                {initials}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  {editingName ? (
                    <input value={nameValue} onChange={e => setNameValue(e.target.value)}
                      onBlur={saveName} onKeyDown={e => e.key === 'Enter' && saveName()}
                      autoFocus
                      className="bg-transparent text-white text-2xl font-bold outline-none border-b border-orange-400 w-48" />
                  ) : (
                    <h1 className="text-2xl font-bold text-white">{displayName}</h1>
                  )}
                  <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-medium flex-shrink-0">
                    👑 总司令
                  </span>
                  {!editingName && (
                    <button onClick={() => setEditingName(true)}
                      className="text-slate-500 hover:text-slate-300 transition flex-shrink-0" title="编辑名字">
                      ✏️
                    </button>
                  )}
                </div>
                <InlineMission value={mission} onSave={saveMission} />
                <p className="text-slate-600 text-xs mt-1.5">
                  数字军团创始人 · {c ? `自 ${new Date(c.createdAt).getFullYear()}年${new Date(c.createdAt).getMonth() + 1}月起` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button onClick={() => setShowPairing(true)}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white text-sm font-semibold shadow-lg shadow-orange-500/25 transition flex items-center gap-2">
                + 招募成员
              </button>
            </div>
          </div>

          {/* Stats bar — X/Y format */}
          <div className="grid grid-cols-4 gap-6 mt-8 pt-7 border-t border-slate-800">
            <StatPill a={onlineCount} b={allAgents.length} labelA="在线" labelB="全部成员" icon="🤖" />
            <StatPill a={ts?.inProgressTasks ?? 0} b={(ts?.inProgressTasks ?? 0) + (ts?.doneTasks ?? 0)} labelA="进行中" labelB="全部任务" icon="📋" />
            <StatPill a={ts?.teamTasks ?? 0} b={(ts?.soloTasks ?? 0) + (ts?.teamTasks ?? 0)} labelA="外部" labelB="内部任务" icon="🌐" />
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{totalMs > 0 ? msToHours(totalMs) : '—'} ⏱️</div>
              <div className="text-xs text-slate-500 mt-0.5">总协作耗时</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content: Left + Right ── */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-6">

          {/* ── LEFT: Main Agent + Links ── */}
          <div className="w-72 flex-shrink-0 space-y-4">
            {/* Main Agent card */}
            {mainAgent
              ? <MainAgentCard agent={mainAgent} liveStatus={liveStatus} />
              : (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                  <div className="text-3xl mb-2">🤖</div>
                  <p className="text-slate-400 text-sm mb-3">还没有总指挥</p>
                  <button onClick={() => setShowPairing(true)}
                    className="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-xs font-semibold">
                    配对总指挥
                  </button>
                </div>
              )
            }

            {/* Quick links */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">快捷操作</div>
              {[
                { icon: '📋', label: '查看所有任务', href: '/' },
                { icon: '🤖', label: '我的 Agent 详情', href: '/agent' },
                { icon: '🌐', label: '官网首页', href: '/landing' },
              ].map(l => (
                <a key={l.href} href={l.href}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-800 text-sm transition">
                  <span>{l.icon}</span><span>{l.label}</span>
                </a>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Sub-agent list ── */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="font-bold text-slate-800">🌊 战队成员</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {subAgents.length} 位成员 · {subAgents.filter(a => a.status !== 'offline').length} 在线
                  </p>
                </div>
                <button onClick={() => setShowPairing(true)}
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white text-sm font-semibold rounded-xl shadow-md shadow-orange-500/20 flex items-center gap-1.5 transition">
                  + 招募成员
                </button>
              </div>

              {/* Column labels */}
              <div className="flex items-center gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-400 uppercase tracking-wide">
                <div className="w-9 flex-shrink-0" />
                <div className="flex-1">成员</div>
                <div className="hidden md:block w-32">技能</div>
                <div className="hidden lg:block w-24 text-right">完成 / 进行</div>
                <div className="hidden md:block w-12 text-right">信誉</div>
              </div>

              {subAgents.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="text-4xl mb-3">🌊</div>
                  <p className="text-slate-400 text-sm">还没有其他战队成员</p>
                  <button onClick={() => setShowPairing(true)}
                    className="mt-4 px-5 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold">
                    招募第一位成员
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {subAgents.map(a => <AgentRow key={a.id} agent={a} />)}
                </div>
              )}

              <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 text-center">
                <p className="text-xs text-slate-400">截图分享你的数字军团 🌊 · TeamAgent</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showPairing && <PairingModal onClose={() => setShowPairing(false)} />}
    </div>
  )
}

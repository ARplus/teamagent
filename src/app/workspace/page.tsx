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
  nickname?: string | null
  email: string
  avatar: string | null
  createdAt: string
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
interface WorkspaceMember {
  type: 'human'
  id: string
  name: string
  nickname: string | null
  email: string
  avatar: string | null
  isSelf: boolean
  role: string
  joinedAt?: string
  agent: {
    id: string; name: string; isMainAgent: boolean
    capabilities: string[]; status: string
    avatar: string | null; personality: string | null
    parentAgentId: string | null
  } | null
}
interface WorkspaceData {
  workspaceId: string
  workspaceName: string
  members: WorkspaceMember[]
}

// ============ Utils ============
function parseCaps(cap: string | null | string[]): string[] {
  if (!cap) return []
  if (Array.isArray(cap)) return cap
  try { const p = JSON.parse(cap); return Array.isArray(p) ? p : [] } catch { return [] }
}

const statusDot: Record<string, string> = {
  online: 'bg-emerald-400', working: 'bg-blue-400', waiting: 'bg-yellow-400', offline: 'bg-slate-400'
}
const statusLabel: Record<string, string> = {
  online: '在线', working: '工作中', waiting: '待命', offline: '离线'
}

function agentAvatar(name: string, avatar?: string | null): string {
  if (avatar && avatar.trim()) return avatar.trim()
  const match = name.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u)
  if (match) return match[0]
  const lower = name.toLowerCase()
  if (lower.includes('lobster') || name.includes('龙虾')) return '🦞'
  return name.charAt(0).toUpperCase()
}

function stripEmoji(name: string): string {
  return name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, '')
}

// ============ Inline editable field ============
function InlineEditable({ value, onSave, placeholder, className }: {
  value: string; onSave: (v: string) => void; placeholder: string; className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select() } }, [editing])
  const save = () => { setEditing(false); if (draft !== value) onSave(draft) }

  if (editing) return (
    <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={save} onKeyDown={e => e.key === 'Enter' && save()}
      className={`bg-transparent outline-none border-b border-orange-400/60 pb-0.5 ${className || ''}`} />
  )
  return (
    <span onClick={() => setEditing(true)}
      className={`cursor-pointer hover:opacity-80 transition ${className || ''}`}>
      {value || placeholder}
    </span>
  )
}

// ============ Invite Partner Inline ============
function InvitePartnerInline({ compact }: { compact?: boolean } = {}) {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyInviteLink = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/workspace/invite', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.inviteUrl) {
        try {
          await navigator.clipboard.writeText(data.inviteUrl)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = data.inviteUrl
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      } else {
        alert(data.error || '生成邀请链接失败')
      }
    } catch { alert('网络错误') }
    finally { setLoading(false) }
  }

  if (compact) {
    return (
      <button onClick={handleCopyInviteLink} disabled={loading}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 flex-shrink-0 ${
          copied
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30'
        } disabled:opacity-50`}>
        <span>{copied ? '✓' : '🔗'}</span>
        <span>{loading ? '...' : copied ? '已复制' : '邀请'}</span>
      </button>
    )
  }

  return (
    <button onClick={handleCopyInviteLink} disabled={loading}
      className={`w-full py-2.5 rounded-xl border-2 border-dashed transition-all text-sm font-medium flex items-center justify-center gap-2 ${
        copied
          ? 'border-emerald-500/70 text-emerald-300 bg-emerald-900/20'
          : 'border-emerald-700/50 hover:border-emerald-500/70 text-emerald-400/80 hover:text-emerald-300 hover:bg-emerald-900/20'
      } disabled:opacity-50`}>
      <span>{copied ? '✓' : '🔗'}</span>
      <span>{loading ? '生成中...' : copied ? '邀请链接已复制！' : '复制邀请链接'}</span>
    </button>
  )
}

// ============ Partner Card ============
function PartnerCard({ member }: { member: WorkspaceMember }) {
  const agent = member.agent
  const initials = (member.name || member.email || '?').charAt(0).toUpperCase()

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 hover:border-slate-600/80 transition-all group">
      {/* Human row */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/80 to-pink-500/80 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200 text-sm truncate">{member.name || member.email}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full border ${member.agent && !member.agent.isMainAgent ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'bg-purple-500/20 text-purple-300 border-purple-500/30'}`}>
              {member.agent && !member.agent.isMainAgent ? '⚙️ 子Agent' : '👤 人类'}
            </span>
          </div>
          <p className="text-xs text-slate-500 truncate">{member.email}</p>
          {member.joinedAt && (
            <p className="text-[11px] text-slate-500 mt-0.5">加入时间：{new Date(member.joinedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </div>
      </div>

      {/* Agent row */}
      {agent ? (
        <div className="ml-6 pl-4 border-l-2 border-slate-700/50">
          <a href={`/agent/${agent.id}`} className="flex items-center gap-2.5 py-1.5 hover:bg-slate-700/30 rounded-lg px-2 -mx-2 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-slate-700/50 border border-slate-600/40 flex items-center justify-center text-lg flex-shrink-0">
              {agentAvatar(agent.name, agent.avatar)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-slate-300 truncate">{stripEmoji(agent.name)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full border ${agent.isMainAgent ? 'bg-orange-500/20 text-orange-300 border-orange-500/30' : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'}`}>
                  {agent.isMainAgent ? '🤖 主Agent' : '⚙️ 子Agent'}
                </span>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[agent.status] || statusDot.offline}`} />
                <span className="text-xs text-slate-500">{statusLabel[agent.status] || '离线'}</span>
              </div>
              {agent.personality && <p className="text-xs text-slate-500 truncate mt-0.5">{agent.personality}</p>}
            </div>
            {agent.capabilities.length > 0 && (
              <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                {agent.capabilities.slice(0, 2).map(c => (
                  <span key={c} className="text-xs px-1.5 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-600/40">{c}</span>
                ))}
              </div>
            )}
          </a>
        </div>
      ) : (
        <div className="ml-6 pl-4 border-l-2 border-slate-700/30">
          <div className="flex items-center gap-2 py-1.5 px-2">
            <span className="text-slate-600 text-sm">暂无 Agent</span>
            <span className="text-xs text-slate-600">（纯人类参与者）</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ My Agent Section ============
function MyAgentCard({ agent, liveStatus }: { agent: AgentData; liveStatus: string }) {
  const caps = parseCaps(agent.capabilities)
  const dot = statusDot[liveStatus] || statusDot.offline
  const label = statusLabel[liveStatus] || '离线'
  const total = agent.stats.doneSteps + agent.stats.pendingSteps
  const pct = total > 0 ? Math.round((agent.stats.doneSteps / total) * 100) : 0

  return (
    <a href="/?t=chat" className="block">
      <div className="rounded-2xl overflow-hidden shadow-md shadow-orange-500/10 border border-slate-700 hover:border-orange-500/40 transition-all">
        <div className="bg-gradient-to-br from-orange-500 to-rose-500 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs px-2.5 py-1 rounded-full bg-white/20 text-white font-medium border border-white/30">⚡ 总指挥</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${dot} ring-2 ring-white/20`} />
              <span className="text-white/80 text-xs">{label}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-3xl border border-white/30">
              {agentAvatar(agent.name, agent.avatar)}
            </div>
            <div>
              <div className="text-white font-bold text-lg">{stripEmoji(agent.name)}</div>
              {agent.personality && <div className="text-white/70 text-xs mt-0.5 line-clamp-2">{agent.personality}</div>}
            </div>
          </div>
          {caps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {caps.map(c => <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-white/15 text-white border border-white/20">{c}</span>)}
            </div>
          )}
        </div>
        <div className="bg-slate-800 p-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="text-center p-2.5 bg-green-900/30 rounded-xl">
              <div className="text-xl font-bold text-green-400">{agent.stats.doneSteps}</div>
              <div className="text-xs text-slate-500">已完成</div>
            </div>
            <div className="text-center p-2.5 bg-blue-900/30 rounded-xl">
              <div className="text-xl font-bold text-blue-400">{agent.stats.pendingSteps}</div>
              <div className="text-xs text-slate-500">进行中</div>
            </div>
          </div>
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-orange-400 to-rose-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          {agent.reputation !== null && agent.reputation > 0 && (
            <div className="flex items-center justify-center gap-1 mt-3">
              {[1,2,3,4,5].map(i => (
                <span key={i} className={`text-sm ${i <= Math.round(agent.reputation ?? 0) ? 'text-yellow-400' : 'text-slate-600'}`}>★</span>
              ))}
              <span className="text-xs text-slate-500 ml-1">{agent.reputation.toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>
    </a>
  )
}

// ============ Sub Agent Card ============
function SubAgentCard({ agent }: { agent: AgentData }) {
  const caps = parseCaps(agent.capabilities)
  const dot = statusDot[agent.status] || statusDot.offline
  const label = statusLabel[agent.status] || '离线'

  return (
    <div className="bg-slate-800/40 rounded-xl border border-slate-700/40 p-3 hover:border-slate-600/60 transition-all group">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-700/60 border border-slate-600/40 flex items-center justify-center text-xl flex-shrink-0">
          {agentAvatar(agent.name, agent.avatar)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-200 truncate">{stripEmoji(agent.name)}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">⚙️ 子Agent</span>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
            <span className="text-xs text-slate-500">{label}</span>
          </div>
          {agent.personality && <p className="text-xs text-slate-500 truncate mt-0.5">{agent.personality}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs text-slate-500">{agent.stats.doneSteps} 完成</div>
        </div>
      </div>
      {caps.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 ml-13">
          {caps.map(c => (
            <span key={c} className="text-xs px-1.5 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-600/40">{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ============ Create Sub Agent Modal ============
function CreateSubAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [personality, setPersonality] = useState('')
  const [capInput, setCapInput] = useState('')
  const [caps, setCaps] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<{ token: string; agentName: string } | null>(null)
  const [error, setError] = useState('')

  const addCap = () => {
    const v = capInput.trim()
    if (v && !caps.includes(v)) { setCaps([...caps, v]); setCapInput('') }
  }
  const removeCap = (c: string) => setCaps(caps.filter(x => x !== c))

  const handleCreate = async () => {
    if (!name.trim() || creating) return
    setCreating(true); setError('')
    try {
      const res = await fetch('/api/agents/create-sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          capabilities: caps,
          personality: personality.trim() || undefined
        })
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ token: data.token, agentName: data.agent.name })
        onCreated()
      } else {
        setError(data.error || '创建失败')
      }
    } catch { setError('网络错误，请重试') }
    finally { setCreating(false) }
  }

  // Show token result
  if (result) return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="text-lg font-bold text-white">{result.agentName} 创建成功！</h3>
          <p className="text-sm text-slate-400 mt-1">以下是 Agent 的 API Token，请妥善保管</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-500 mb-1">API Token（仅显示一次）</p>
          <p className="text-xs text-orange-300 font-mono break-all select-all">{result.token}</p>
        </div>
        <p className="text-xs text-slate-500 text-center">⚠️ 请复制保存此 Token，关闭后无法再次查看</p>
        <button onClick={onClose}
          className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition">
          我已保存，关闭
        </button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>⚙️</span> 创建子 Agent
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">✕</button>
        </div>

        <p className="text-xs text-slate-500">子 Agent 归属于你的主 Agent，可以执行分配的任务步骤</p>

        {/* Name */}
        <div>
          <label className="text-sm text-slate-300 mb-1 block">名称 <span className="text-rose-400">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="如：Galileo、Compass..."
            className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
        </div>

        {/* Personality */}
        <div>
          <label className="text-sm text-slate-300 mb-1 block">个性描述</label>
          <textarea value={personality} onChange={e => setPersonality(e.target.value)} rows={2}
            placeholder="如：擅长市场调研，行事严谨..."
            className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500 transition resize-none" />
        </div>

        {/* Capabilities */}
        <div>
          <label className="text-sm text-slate-300 mb-1 block">能力标签</label>
          <div className="flex items-center gap-1.5">
            <input value={capInput} onChange={e => setCapInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCap() } }}
              placeholder="输入标签后回车"
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
            <button onClick={addCap}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition">+</button>
          </div>
          {caps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {caps.map(c => (
                <span key={c} className="text-xs px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                  {c}
                  <button onClick={() => removeCap(c)} className="text-cyan-400 hover:text-white">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <div className="text-sm text-rose-400 text-center">{error}</div>}

        <button onClick={handleCreate} disabled={!name.trim() || creating}
          className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition disabled:opacity-50">
          {creating ? '⏳ 创建中...' : '🚀 创建子 Agent'}
        </button>
      </div>
    </div>
  )
}

// ============ Main Page ============
export default function WorkspacePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [teamData, setTeamData] = useState<TeamData | null>(null)
  const [wsData, setWsData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPairing, setShowPairing] = useState(false)
  const [showCreateSub, setShowCreateSub] = useState(false)
  const [liveStatus, setLiveStatus] = useState('offline')

  // Editable fields
  const [nameValue, setNameValue] = useState('')
  const [mission, setMission] = useState('')

  useEffect(() => {
    if (session) fetchAll()
    else if (status === 'unauthenticated') router.push('/login')
  }, [session, status])

  useEffect(() => {
    fetch('/api/agent/status').then(r => r.json()).then(d => setLiveStatus(d.status || 'offline')).catch(() => {})
  }, [])

  // Auto-refresh on focus + polling
  useEffect(() => {
    if (!session) return
    const onFocus = () => fetchAll()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(fetchAll, 20000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer) }
  }, [session])

  const fetchAll = async () => {
    try {
      const [teamRes, wsRes] = await Promise.all([
        fetch('/api/agents/team'),
        fetch('/api/workspace/team')
      ])
      if (teamRes.ok) {
        const d: TeamData = await teamRes.json()
        setTeamData(d)
        setNameValue(d.commander.name || '')
        setMission(d.commander.nickname || '')
      }
      if (wsRes.ok) {
        const d: WorkspaceData = await wsRes.json()
        setWsData(d)
      }
    } finally { setLoading(false) }
  }

  const saveName = async (v: string) => {
    setNameValue(v)
    await fetch('/api/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v }) })
  }

  const saveMission = async (v: string) => {
    setMission(v)
    await fetch('/api/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: v }) })
  }

  if (status === 'loading' || loading) return (
    <div className="h-screen flex items-center justify-center bg-slate-900">
      <div className="text-center">
        <div className="text-5xl mb-3 animate-bounce">🏠</div>
        <div className="text-slate-400 text-sm">加载工作区...</div>
      </div>
    </div>
  )

  const c = teamData?.commander
  const mainAgent = teamData?.mainAgent
  const ts = teamData?.taskStats
  // 过滤掉子Agent用户（它们已在左侧"子AGENT军团"显示），只保留真正的人类协作者
  const partners = (wsData?.members || []).filter(m => !m.isSelf && !(m.agent && !m.agent.isMainAgent && m.agent.parentAgentId))
  const onlinePartnerAgents = partners.filter(p => p.agent && p.agent.status !== 'offline').length
  const displayName = nameValue || c?.name || c?.email || '用户'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-slate-900 pb-24 md:pb-0">
      <Navbar />

      {/* ── Hero Banner ── */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/8 rounded-full blur-3xl -translate-y-1/2" />
          <div className="absolute top-0 right-1/3 w-80 h-80 bg-rose-500/8 rounded-full blur-3xl -translate-y-1/2" />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 relative">
          <div className="flex items-start gap-4 sm:gap-5">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-xl sm:text-2xl font-bold shadow-lg shadow-orange-500/30 flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 mb-1.5 flex-wrap">
                <InlineEditable
                  value={nameValue}
                  onSave={saveName}
                  placeholder="点击设置名字"
                  className="text-lg sm:text-2xl font-bold text-white"
                />
                <span className="text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-medium flex-shrink-0">
                  👑 总司令
                </span>
              </div>
              <InlineEditable
                value={mission}
                onSave={saveMission}
                placeholder="「点击填写你的使命宣言」"
                className="text-slate-400 text-sm italic hover:text-slate-300 block max-w-xl leading-relaxed"
              />
              <p className="text-slate-600 text-xs mt-1.5">
                {c ? `自 ${new Date(c.createdAt).getFullYear()}年${new Date(c.createdAt).getMonth() + 1}月起` : ''}
                {wsData ? ` · ${wsData.workspaceName}` : ''}
              </p>
            </div>
          </div>

          {/* Quick stats row */}
          {ts && (
            <div className="flex items-center gap-6 mt-5 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-white">{ts.inProgressTasks}</span>
                <span className="text-xs text-slate-500">进行中</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-emerald-400">{ts.doneTasks}</span>
                <span className="text-xs text-slate-500">已完成</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-slate-400">{ts.soloTasks}</span>
                <span className="text-xs text-slate-600">Solo</span>
                <span className="text-slate-700">/</span>
                <span className="text-lg font-semibold text-orange-400">{ts.teamTasks}</span>
                <span className="text-xs text-slate-600">Team</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{partners.length} 位协作伙伴</span>
                {onlinePartnerAgents > 0 && (
                  <span className="text-xs text-emerald-500">{onlinePartnerAgents} Agent 在线</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── LEFT: My Agent + Actions ── */}
          <div className="lg:w-72 flex-shrink-0 space-y-4">
            {/* Main Agent Card */}
            {mainAgent ? (
              <MyAgentCard agent={mainAgent} liveStatus={liveStatus} />
            ) : (
              <div className="bg-slate-800 rounded-2xl border border-dashed border-slate-600 p-6 text-center">
                <div className="text-3xl mb-2">🤖</div>
                <p className="text-slate-400 text-sm mb-3">还没有主 Agent</p>
                <button onClick={() => setShowPairing(true)}
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-xs font-semibold">
                  配对总指挥
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button onClick={() => setShowPairing(true)}
                className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-slate-600 hover:border-orange-500/50 text-slate-400 hover:text-orange-300 hover:bg-orange-900/10 transition-all text-sm font-medium flex items-center justify-center gap-1.5">
                <span>🔗</span><span>配对</span>
              </button>
              {mainAgent && (
                <button onClick={() => setShowCreateSub(true)}
                  className="flex-1 py-2.5 rounded-xl border-2 border-dashed border-slate-600 hover:border-cyan-500/50 text-slate-400 hover:text-cyan-300 hover:bg-cyan-900/10 transition-all text-sm font-medium flex items-center justify-center gap-1.5">
                  <span>⚙️</span><span>创建子Agent</span>
                </button>
              )}
            </div>

            {/* Sub Agents List */}
            {teamData && teamData.subAgents.length > 0 && (
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">⚙️ 子Agent军团</h3>
                  <span className="text-xs text-slate-600">{teamData.subAgents.length} 个</span>
                </div>
                <div className="space-y-2">
                  {teamData.subAgents.map(sub => (
                    <SubAgentCard key={sub.id} agent={sub} />
                  ))}
                </div>
              </div>
            )}

            {/* Workspace stats card */}
            {ts && (
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-4">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">📊 工作区统计</h3>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">进行中任务</span>
                    <span className="text-sm font-semibold text-blue-400">{ts.inProgressTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">已完成任务</span>
                    <span className="text-sm font-semibold text-emerald-400">{ts.doneTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Solo / Team</span>
                    <span className="text-sm font-semibold text-slate-300">{ts.soloTasks} / {ts.teamTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">协作伙伴</span>
                    <span className="text-sm font-semibold text-purple-400">{partners.length} 人</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Collaboration Network ── */}
          <div className="flex-1 min-w-0 space-y-6">

            {/* 协作伙伴 Section */}
            <div className="bg-slate-800/30 rounded-2xl border border-slate-700/50 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
                <div>
                  <h2 className="font-bold text-white flex items-center gap-2">
                    <span>👥</span> 协作伙伴
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {partners.length} 位伙伴 · {onlinePartnerAgents} 个 Agent 在线
                  </p>
                </div>
                <InvitePartnerInline compact />
              </div>

              <div className="p-4 space-y-3">
                {/* Self card first */}
                {wsData?.members.filter(m => m.isSelf).map(me => (
                  <div key={me.id} className="bg-slate-800/80 rounded-xl border border-orange-500/20 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm">{me.name || me.email}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">我自己</span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">👑 {me.role === 'owner' ? '创建者' : me.role}</span>
                        </div>
                        <p className="text-xs text-slate-500">{me.email}</p>
                      </div>
                    </div>
                    {mainAgent && (
                      <div className="ml-6 pl-4 border-l-2 border-orange-500/30">
                        <div className="flex items-center gap-2.5 py-1.5">
                          <div className="w-8 h-8 rounded-lg bg-slate-700/50 border border-orange-500/30 flex items-center justify-center text-lg flex-shrink-0">
                            {agentAvatar(mainAgent.name, mainAgent.avatar)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-orange-200">{stripEmoji(mainAgent.name)}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300">⚡ 总指挥</span>
                              <span className={`w-2 h-2 rounded-full ${statusDot[liveStatus] || statusDot.offline}`} />
                              <span className="text-xs text-slate-500">{statusLabel[liveStatus] || '离线'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Partner cards */}
                {partners.map(p => <PartnerCard key={p.id} member={p} />)}

                {/* Empty state */}
                {partners.length === 0 && (
                  <div className="py-8 text-center">
                    <div className="text-4xl mb-3">🤝</div>
                    <p className="text-slate-500 text-sm mb-1">还没有协作伙伴</p>
                    <p className="text-slate-600 text-xs">邀请朋友加入，一起用 Agent 协作完成任务</p>
                  </div>
                )}

                {/* Invite button */}
                <InvitePartnerInline />
              </div>
            </div>

          </div>
        </div>
      </div>

      {showPairing && <PairingModal onClose={() => setShowPairing(false)} />}
      {showCreateSub && (
        <CreateSubAgentModal
          onClose={() => setShowCreateSub(false)}
          onCreated={() => fetchAll()}
        />
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

// ============ Types ============

interface AgentData {
  id: string
  name: string
  personality: string | null
  avatar: string | null
  status: string
  capabilities: string | null
  reputation: number | null
  claimedAt: string | null
  user: { id: string; name: string | null; email: string } | null
  soul: string | null          // 🆕 SOUL 人格核心
  growthXP: number             // 🆕 经验值
  growthLevel: number          // 🆕 等级 (1-5)
}

interface Stats {
  totalSteps: number
  pendingSteps: number
  rejectedCount: number
  appealWonCount: number
  avgDurationMs: number | null
}

interface RecentStep {
  id: string
  title: string
  status: string
  updatedAt: string
  completedAt: string | null
  task: { id: string; title: string } | null
}

interface ProfileData {
  agent: AgentData
  stats: Stats
  recentSteps: RecentStep[]
  isOwner: boolean
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

function formatAvgDuration(ms: number | null): string {
  if (!ms) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours}小时${minutes % 60}分钟`
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatClaimedAt(dateStr: string | null): string {
  if (!dateStr) return '未知'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

const statusMap: Record<string, { icon: string; label: string; dot: string }> = {
  online:  { icon: '🟢', label: '在线',   dot: 'bg-emerald-500' },
  working: { icon: '🟡', label: '工作中', dot: 'bg-blue-500' },
  waiting: { icon: '🟠', label: '等待中', dot: 'bg-amber-500' },
  offline: { icon: '⚫', label: '离线',   dot: 'bg-slate-400' },
}

const stepStatusMap: Record<string, { icon: string; label: string; color: string }> = {
  done:              { icon: '✅', label: '已完成',   color: 'text-emerald-600' },
  rejected:          { icon: '❌', label: '被打回',   color: 'text-red-500' },
  waiting_approval:  { icon: '⏳', label: '待审批',   color: 'text-amber-600' },
  in_progress:       { icon: '🔄', label: '进行中',   color: 'text-blue-600' },
  pending:           { icon: '⏸️', label: '等待中',   color: 'text-slate-500' },
}

// ============ Growth Utils ============

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000]

function getXPProgress(xp: number, level: number): number {
  const cur = LEVEL_THRESHOLDS[level - 1] || 0
  const next = LEVEL_THRESHOLDS[level]
  if (next == null || level >= LEVEL_THRESHOLDS.length) return 100
  const range = next - cur
  if (range <= 0) return 100
  return Math.min(100, Math.round(((xp - cur) / range) * 100))
}

function getLevelTitle(level: number): string {
  const titles = ['新兵', '列兵', '精英', '老兵', '传说']
  return titles[Math.min(level - 1, titles.length - 1)]
}

// 渐变色池
const gradients = [
  'from-orange-500 via-rose-500 to-pink-500',
  'from-violet-500 via-purple-500 to-indigo-500',
  'from-rose-500 via-pink-500 to-fuchsia-500',
  'from-blue-500 via-indigo-500 to-violet-500',
  'from-amber-500 via-orange-500 to-red-500',
]

function pickGradient(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff
  }
  return gradients[Math.abs(hash) % gradients.length]
}

// ============ Edit Modal ============

function EditAgentModal({ agent, onClose, onSaved }: { agent: AgentData; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(agent.name)
  const [personality, setPersonality] = useState(agent.personality ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/agent/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), personality: personality.trim() })
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || '保存失败')
        return
      }
      onSaved()
      onClose()
    } catch (e) {
      alert('网络错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center space-x-3 mb-6">
          <span className="text-3xl">✏️</span>
          <h2 className="text-xl font-bold text-slate-900">编辑 Agent</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">Agent 名字</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500/50 focus:border-orange-400"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">性格描述</label>
            <textarea
              value={personality}
              onChange={e => setPersonality(e.target.value)}
              rows={3}
              placeholder="描述你的 Agent 的性格特点..."
              className="w-full px-4 py-3 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-400"
            />
          </div>
          <p className="text-xs text-slate-400">⚠️ 编辑功能即将上线，目前为预览模式</p>
        </div>
        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="px-5 py-2.5 text-slate-600 hover:text-slate-800 font-medium">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-semibold shadow-lg shadow-orange-500/25 hover:from-orange-400 hover:to-rose-400 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============ Main Page ============

export default function AgentProfileByIdPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const agentId = params.id as string

  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)

  const fetchProfile = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    if (status === 'authenticated') {
      fetchProfile()
    }
  }, [status, agentId])

  if (status === 'loading' || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🦞</div>
          <div className="text-slate-500 text-sm">加载中...</div>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="flex flex-col items-center justify-center py-32">
          <div className="text-6xl mb-6">🌊</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Agent 不存在</h2>
          <p className="text-slate-500 mb-8">找不到这个 Agent，可能已被删除</p>
          <button
            onClick={() => router.push('/agents')}
            className="px-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-semibold hover:from-orange-400 hover:to-rose-400 transition-all"
          >
            ← 回到战队
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { agent, stats, recentSteps, isOwner } = data
  const capabilities = parseCapabilities(agent.capabilities)
  const agentStatus = statusMap[agent.status] ?? statusMap.offline
  const gradient = pickGradient(agent.id)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-orange-50/20">
      <Navbar />

      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* 返回战队 */}
        <button
          onClick={() => router.push('/agents')}
          className="flex items-center space-x-2 text-slate-500 hover:text-slate-800 text-sm mb-6 transition-colors"
        >
          <span>←</span>
          <span>我的战队</span>
        </button>

        <div className="space-y-6">

          {/* ① 身份卡 */}
          <div className="relative rounded-3xl overflow-hidden shadow-xl shadow-orange-500/10">
            <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
            <div className="absolute -top-16 -right-16 w-64 h-64 bg-white/10 rounded-full" />
            <div className="absolute -bottom-8 -left-8 w-48 h-48 bg-white/5 rounded-full" />

            <div className="relative p-6 sm:p-8">
              {(() => {
                const emojiMatch = agent.name.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u)
                // Lobster 等无 emoji 前缀的 agent，用名称首字母兜底；已知主 Agent 用 🦞
                const fallback = agent.name.toLowerCase().includes('lobster') ? '🦞' : agent.name.charAt(0)
                const avatarIcon = agent.avatar?.trim() || (emojiMatch ? emojiMatch[0] : fallback)
                const displayName = agent.name.replace(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u, '')
                return (
              <div className="flex flex-col items-center sm:flex-row sm:items-start sm:space-x-6">
                {/* Avatar */}
                <div className="flex-shrink-0 mb-4 sm:mb-0">
                  {agent.avatar && agent.avatar.startsWith('http') ? (
                    <img
                      src={agent.avatar}
                      alt={agent.name}
                      className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover shadow-2xl border-4 border-white/30"
                    />
                  ) : (
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-5xl shadow-2xl border-4 border-white/30">
                      {avatarIcon}
                    </div>
                  )}
                </div>

                {/* 主信息 */}
                <div className="flex-1 min-w-0 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start space-x-2 mb-2">
                    <h1 className="text-2xl sm:text-3xl font-bold text-white">{displayName}</h1>
                    <span className="text-lg">{agentStatus.icon}</span>
                    <span className="text-sm text-white/80">{agentStatus.label}</span>
                  </div>

                  {/* 所属用户 */}
                  {agent.user && (
                    <div className="mb-3">
                      <span className="inline-block bg-white/20 backdrop-blur text-white/90 text-sm px-3 py-1 rounded-full">
                        👤 {agent.user.name || agent.user.email}
                        {isOwner && ' (你)'}
                      </span>
                    </div>
                  )}

                  {/* 性格标签 */}
                  {agent.personality && (
                    <div className="mb-3">
                      <span className="inline-block bg-white/20 backdrop-blur text-white/90 text-sm px-3 py-1 rounded-full">
                        {agent.personality}
                      </span>
                    </div>
                  )}

                  {/* 能力标签 */}
                  {capabilities.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3 justify-center sm:justify-start">
                      {capabilities.map((cap, i) => (
                        <span key={i} className="bg-white/20 backdrop-blur text-white text-xs px-2.5 py-1 rounded-lg font-medium border border-white/20">
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 🆕 等级 + XP 进度条 */}
                  <div className="flex items-center gap-3 mb-3 justify-center sm:justify-start">
                    <span className="bg-white/25 backdrop-blur text-white text-sm px-3 py-1 rounded-full font-bold border border-white/20">
                      🎖️ Lv.{agent.growthLevel} {getLevelTitle(agent.growthLevel)}
                    </span>
                    <span className="text-white/80 text-sm">{agent.growthXP} XP</span>
                  </div>
                  <div className="w-full max-w-xs mb-3 mx-auto sm:mx-0">
                    <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-yellow-300 to-amber-400 rounded-full transition-all duration-500"
                        style={{ width: `${getXPProgress(agent.growthXP, agent.growthLevel)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-white/50 text-xs mt-1">
                      <span>Lv.{agent.growthLevel}</span>
                      <span>{agent.growthLevel < 5 ? `Lv.${agent.growthLevel + 1}` : 'MAX'}</span>
                    </div>
                  </div>

                  {/* 信誉分 */}
                  {agent.reputation !== null && agent.reputation !== undefined && (
                    <div className="flex items-center justify-center sm:justify-start space-x-2 mb-3">
                      <div className="flex items-center space-x-0.5">
                        {[1, 2, 3, 4, 5].map(i => (
                          <span key={i} className={`text-lg ${i <= Math.round(agent.reputation ?? 0) ? 'text-amber-300' : 'text-white/30'}`}>
                            ★
                          </span>
                        ))}
                      </div>
                      <span className="text-white/80 text-sm">{(agent.reputation ?? 0).toFixed(1)} / 5</span>
                    </div>
                  )}

                  {/* 加入时间 */}
                  {agent.claimedAt && (
                    <div className="text-white/70 text-sm">
                      📅 自 {formatClaimedAt(agent.claimedAt)} 起服役
                    </div>
                  )}
                </div>
              </div>
                )
              })()}
            </div>
          </div>

          {/* ② 战绩卡 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 text-center">
              <div className="text-3xl mb-1">✅</div>
              <div className="text-2xl font-bold text-slate-900">{stats.totalSteps}</div>
              <div className="text-xs text-slate-500 mt-1">已完成步骤</div>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 text-center">
              <div className="text-3xl mb-1">🔄</div>
              <div className="text-2xl font-bold text-slate-900">{stats.pendingSteps}</div>
              <div className="text-xs text-slate-500 mt-1">进行中步骤</div>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 text-center">
              <div className="text-3xl mb-1">🎖️</div>
              <div className="text-2xl font-bold text-slate-900">Lv.{agent.growthLevel}</div>
              <div className="text-xs text-slate-500 mt-1">{getLevelTitle(agent.growthLevel)}</div>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 text-center">
              <div className="text-3xl mb-1">⚡</div>
              <div className="text-sm font-bold text-slate-900 leading-tight pt-1">
                {formatAvgDuration(stats.avgDurationMs)}
              </div>
              <div className="text-xs text-slate-500 mt-1">平均耗时</div>
            </div>
          </div>

          {/* ③ 最近步骤 */}
          {recentSteps.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center space-x-2">
                  <span>📋</span>
                  <span>最近动态</span>
                </h3>
              </div>
              <div className="divide-y divide-slate-50">
                {recentSteps.map(step => {
                  const stepStatus = stepStatusMap[step.status] ?? stepStatusMap.pending
                  return (
                    <div key={step.id} className="flex items-center px-6 py-4 hover:bg-slate-50 transition-colors">
                      <span className="text-xl flex-shrink-0 mr-3">{stepStatus.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{step.title}</div>
                        {step.task && (
                          <div className="text-xs text-slate-400 mt-0.5 truncate">📁 {step.task.title}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right ml-3">
                        <span className={`text-xs font-medium ${stepStatus.color}`}>{stepStatus.label}</span>
                        <div className="text-xs text-slate-400 mt-0.5">{formatTime(step.updatedAt)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 🆕 SOUL 人格核心 */}
          {agent.soul && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center space-x-2">
                  <span>🧬</span>
                  <span>人格核心 (SOUL)</span>
                </h3>
              </div>
              <div className="px-6 py-4 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                {agent.soul}
              </div>
            </div>
          )}

          {/* 额外信息 */}
          {(stats.rejectedCount > 0 || stats.appealWonCount > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {stats.rejectedCount > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">🔄</div>
                  <div className="text-xl font-bold text-red-700">{stats.rejectedCount}</div>
                  <div className="text-xs text-red-500 mt-1">累计被打回次数</div>
                </div>
              )}
              {stats.appealWonCount > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">⚖️</div>
                  <div className="text-xl font-bold text-emerald-700">{stats.appealWonCount}</div>
                  <div className="text-xs text-emerald-500 mt-1">申诉成功次数</div>
                </div>
              )}
            </div>
          )}

          {/* ④ 底部操作 */}
          {isOwner && (
            <div className="flex justify-center pb-4">
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center space-x-2 px-8 py-3 bg-white border border-slate-200 rounded-2xl text-slate-700 font-medium shadow-sm hover:shadow-md hover:border-orange-300 hover:text-orange-600 transition-all"
              >
                <span>✏️</span>
                <span>编辑 Agent</span>
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <EditAgentModal
          agent={agent}
          onClose={() => setShowEditModal(false)}
          onSaved={fetchProfile}
        />
      )}
    </div>
  )
}

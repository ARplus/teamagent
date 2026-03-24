'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

interface TemplateItem {
  id: string
  name: string
  description: string | null
  icon: string | null
  category: string
  tags: string | null
  variables: string
  stepsTemplate: string
  defaultMode: string
  defaultPriority: string
  schedule: string | null
  scheduleEnabled: boolean
  isPublic: boolean
  visibility: 'public' | 'workspace' | 'private'
  isDraft: boolean
  useCount: number
  lastUsedAt: string | null
  createdAt: string
  creator?: { id: string; name: string | null; avatar: string | null; agent?: { name: string } | null }
  _count?: { instances: number }
}

const VISIBILITY_OPTIONS = [
  { value: 'public',    icon: '🌐', label: '公开', desc: '所有人可见' },
  { value: 'workspace', icon: '🏢', label: '工作区', desc: '仅工作区成员' },
  { value: 'private',   icon: '🔒', label: '私有', desc: '仅自己可见' },
] as const

interface VariableDef {
  name: string
  label: string
  type: 'string' | 'number' | 'date' | 'select'
  required?: boolean
  default?: any
  defaultValue?: any
  description?: string
  options?: string[]
}

interface StepTpl {
  order: number
  title: string
  description?: string
  assigneeRole?: string
  partyRole?: string
}

interface PartyConfig {
  role: string       // "party-a" | "party-b" | "party-c" ...
  label: string      // 显示名称（用户可编辑）
  bindType: 'self' | 'simulate' | 'invite' | 'agent'
  orgName: string    // simulate/invite 时的名称
  materials: string  // 资料 URL，逗号分隔（P0 简化）
}

const PARTY_LABELS: Record<string, string> = {
  'party-a': '甲方',
  'party-b': '乙方',
  'party-c': '第三方',
  'party-d': '第四方',
  'party-e': '第五方',
}

function getPartyRoles(stepsTemplate: string): string[] {
  try {
    const steps = JSON.parse(stepsTemplate)
    const roles = new Set<string>()
    for (const s of steps) {
      if (s.partyRole && typeof s.partyRole === 'string' && s.partyRole.startsWith('party-')) {
        roles.add(s.partyRole)
      }
    }
    return Array.from(roles).sort()
  } catch { return [] }
}

function nextPartyRole(existing: PartyConfig[]): string {
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  for (const l of letters) {
    if (!existing.find(p => p.role === `party-${l}`)) return `party-${l}`
  }
  return `party-${Date.now()}`
}

const CATEGORIES = [
  { value: 'all', label: '全部', icon: '🔍' },
  { value: 'general', label: '通用', icon: '📋' },
  { value: 'report', label: '报告', icon: '📊' },
  { value: 'research', label: '调研', icon: '🔬' },
  { value: 'development', label: '开发', icon: '💻' },
  { value: 'design', label: '设计', icon: '🎨' },
  { value: 'marketing', label: '营销', icon: '📣' },
  { value: 'operations', label: '运维', icon: '⚙️' },
]

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return tags.split(',').map(s => s.trim()).filter(Boolean)
  }
}

function parseVariables(variables: string): VariableDef[] {
  try {
    const parsed = JSON.parse(variables)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function parseSteps(stepsTemplate: string): StepTpl[] {
  try {
    const parsed = JSON.parse(stepsTemplate)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

export default function TemplatesPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, any>>({})
  const [running, setRunning] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [runResult, setRunResult] = useState<{ taskId: string; title: string; stepsCreated: number; pendingInviteCount?: number; inviteLinks?: { role: string; label: string; url: string }[] } | null>(null)
  const [parties, setParties] = useState<PartyConfig[]>([])
  const [visibility, setVisibility] = useState<'public' | 'workspace' | 'private'>('workspace')

  // 筛选条件（客户端过滤）
  const [filterMode, setFilterMode] = useState<'all' | 'solo' | 'team'>('all')
  const [filterVis, setFilterVis] = useState<'all' | 'public' | 'workspace' | 'private' | 'draft'>('all')

  // 创建/编辑模态框
  const [editMode, setEditMode] = useState<'create' | 'edit' | null>(null)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    icon: '',
    category: 'general',
    defaultMode: 'solo' as 'solo' | 'team',
    isDraft: true,
    visibility: 'workspace' as 'public' | 'workspace' | 'private',
    requiresApprovalGate: false,
    variables: '[]',
    stepsTemplate: JSON.stringify([{ order: 1, title: '步骤一', description: '' }], null, 2),
  })

  // 工作区角色
  const [myWorkspaceRole, setMyWorkspaceRole] = useState<string | null>(null)

  const isSuperAdmin = ADMIN_EMAILS.includes(session?.user?.email || '')
  // 超级管理员 or 工作区 owner/admin 都算有管理权
  const isAdmin = isSuperAdmin || myWorkspaceRole === 'owner' || myWorkspaceRole === 'admin'
  const isOwnTemplate = selectedTemplate?.creator?.id === (session as any)?.user?.id
  // 可以编辑/删除：自己创建的 or 有管理权的
  const canManage = isOwnTemplate || isAdmin

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
  }, [authStatus, router])

  // 获取当前用户在工作区的角色
  useEffect(() => {
    if (!session) return
    fetch('/api/workspaces/my')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.workspace?.id) {
          fetch(`/api/workspaces/${data.workspace.id}/members`)
            .then(r => r.ok ? r.json() : null)
            .then(mData => {
              const currentUserId = (session as any)?.user?.id
              const me = mData?.members?.find((m: any) => m.user.id === currentUserId)
              if (me) setMyWorkspaceRole(me.role)
            })
        }
      })
      .catch(() => {})
  }, [session])

  const fetchTemplates = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (category !== 'all') params.set('category', category)
      if (search) params.set('q', search)
      const res = await fetch(`/api/templates?${params}`)
      if (res.ok) {
        setTemplates(await res.json())
      }
    } catch (e) {
      console.error('获取模版失败:', e)
    } finally {
      setLoading(false)
    }
  }, [category, search])

  useEffect(() => {
    setLoading(true)
    fetchTemplates()
  }, [fetchTemplates])

  const openTemplate = (t: TemplateItem) => {
    setSelectedTemplate(t)
    setRunResult(null)
    setVisibility(t.visibility || (t.isPublic ? 'public' : 'workspace'))
    // 预填默认值
    const vars = parseVariables(t.variables)
    const defaults: Record<string, any> = {}
    vars.forEach(v => {
      const val = v.default !== undefined ? v.default : v.defaultValue
      if (val !== undefined) defaults[v.name] = val
    })
    setVariableValues(defaults)
    // 初始化参与方：扫描模版步骤中的 partyRole，自动生成参与方列表
    const roles = getPartyRoles(t.stepsTemplate)
    const isTeam = t.defaultMode === 'team'
    if (roles.length > 0 || isTeam) {
      const uniqueRoles = roles.length > 0 ? roles : ['party-a', 'party-b']
      setParties(uniqueRoles.map(role => ({
        role,
        label: PARTY_LABELS[role] || role,
        bindType: role === 'party-a' ? 'self' : 'simulate',
        orgName: '',
        materials: '',
      })))
    } else {
      setParties([])
    }
  }

  const runTemplate = async () => {
    if (!selectedTemplate) return
    setRunning(true)
    try {
      // 构建 parties 请求体（只在有参与方配置时传入）
      const partiesPayload = parties.length > 0 ? parties.map(p => ({
        role: p.role,
        label: p.label,
        bindType: p.bindType,
        ...(p.orgName ? { orgName: p.orgName } : {}),
        ...(p.materials ? { materials: p.materials.split(',').map(s => s.trim()).filter(Boolean) } : {}),
      })) : undefined

      const res = await fetch(`/api/templates/${selectedTemplate.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: variableValues,
          ...(partiesPayload ? { parties: partiesPayload } : {}),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        // 为 invite 参与方自动生成邀请链接（带 partyRole，接受后自动绑定步骤）
        const inviteLinks: { role: string; label: string; url: string }[] = []
        for (const p of parties) {
          if (p.bindType === 'invite') {
            try {
              const invRes = await fetch(`/api/tasks/${data.taskId}/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ partyRole: p.role }),
              })
              if (invRes.ok) {
                const invData = await invRes.json()
                inviteLinks.push({ role: p.role, label: p.label || p.role, url: invData.inviteUrl })
              }
            } catch (_) {}
          }
        }
        setRunResult({ ...data, ...(inviteLinks.length > 0 ? { inviteLinks } : {}) })
        fetchTemplates() // 刷新 useCount
      } else {
        alert(data.error || '执行失败')
      }
    } catch (e) {
      console.error('执行模版失败:', e)
      alert('执行失败，请重试')
    } finally {
      setRunning(false)
    }
  }

  const deleteTemplate = async () => {
    if (!selectedTemplate) return
    if (!confirm(`确定删除模版「${selectedTemplate.name}」？此操作不可撤销。`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/templates/${selectedTemplate.id}`, { method: 'DELETE' })
      if (res.ok) {
        setSelectedTemplate(null)
        fetchTemplates()
      } else {
        const data = await res.json()
        alert(data.error || '删除失败')
      }
    } catch { alert('删除失败，请重试') }
    finally { setDeleting(false) }
  }

  const toggleDraft = async () => {
    if (!selectedTemplate) return
    setPublishing(true)
    try {
      const newDraft = !selectedTemplate.isDraft
      const res = await fetch(`/api/templates/${selectedTemplate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDraft: newDraft, ...(!newDraft ? { visibility } : {}) }),
      })
      if (res.ok) {
        setSelectedTemplate({ ...selectedTemplate, isDraft: newDraft, visibility })
        fetchTemplates()
      } else {
        const data = await res.json()
        alert(data.error || '操作失败')
      }
    } catch { alert('操作失败') }
    finally { setPublishing(false) }
  }

  const openCreateForm = () => {
    setFormData({
      name: '',
      description: '',
      icon: '',
      category: 'general',
      defaultMode: 'solo',
      isDraft: true,
      visibility: 'workspace',
      requiresApprovalGate: false,
      variables: '[]',
      stepsTemplate: JSON.stringify([{ order: 1, title: '步骤一', description: '' }], null, 2),
    })
    setEditMode('create')
  }

  const openEditForm = (t: TemplateItem) => {
    setFormData({
      name: t.name,
      description: t.description || '',
      icon: t.icon || '',
      category: t.category || 'general',
      defaultMode: (t.defaultMode as 'solo' | 'team') || 'solo',
      isDraft: t.isDraft,
      visibility: t.visibility || 'workspace',
      requiresApprovalGate: (t as any).requiresApprovalGate ?? false,
      variables: (() => { try { return JSON.stringify(JSON.parse(t.variables), null, 2) } catch { return '[]' } })(),
      stepsTemplate: (() => { try { return JSON.stringify(JSON.parse(t.stepsTemplate), null, 2) } catch { return t.stepsTemplate } })(),
    })
    setEditMode('edit')
  }

  const saveTemplate = async () => {
    if (!formData.name.trim()) { alert('请填写模版名称'); return }
    let stepsArr: any[]
    try { stepsArr = JSON.parse(formData.stepsTemplate) } catch { alert('步骤 JSON 格式有误，请检查'); return }
    if (!Array.isArray(stepsArr) || stepsArr.length === 0) { alert('步骤不能为空'); return }
    let varsArr: any[]
    try { varsArr = JSON.parse(formData.variables) } catch { alert('变量 JSON 格式有误，请检查'); return }

    setSaving(true)
    try {
      if (editMode === 'create') {
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            description: formData.description.trim() || undefined,
            icon: formData.icon.trim() || undefined,
            category: formData.category,
            defaultMode: formData.defaultMode,
            isDraft: formData.isDraft,
            visibility: formData.visibility,
            requiresApprovalGate: formData.requiresApprovalGate,
            variables: varsArr,
            stepsTemplate: stepsArr,
          }),
        })
        const data = await res.json()
        if (!res.ok) { alert(data.error || '创建失败'); return }
      } else if (editMode === 'edit' && selectedTemplate) {
        const res = await fetch(`/api/templates/${selectedTemplate.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            icon: formData.icon.trim() || null,
            category: formData.category,
            defaultMode: formData.defaultMode,
            isDraft: formData.isDraft,
            visibility: formData.visibility,
            requiresApprovalGate: formData.requiresApprovalGate,
            variables: varsArr,
            stepsTemplate: stepsArr,
          }),
        })
        const data = await res.json()
        if (!res.ok) { alert(data.error || '保存失败'); return }
      }
      setEditMode(null)
      setSelectedTemplate(null)
      fetchTemplates()
    } catch { alert('操作失败，请重试') }
    finally { setSaving(false) }
  }

  const updateVisibility = async (newVis: 'public' | 'workspace' | 'private') => {
    if (!selectedTemplate) return
    setVisibility(newVis)
    if (!selectedTemplate.isDraft) {
      // 非草稿时立即保存
      await fetch(`/api/templates/${selectedTemplate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVis }),
      }).catch(() => {})
      setSelectedTemplate({ ...selectedTemplate, visibility: newVis })
      fetchTemplates()
    }
  }

  if (authStatus === 'loading' || (loading && templates.length === 0)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-orange-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-3">
          <a href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-orange-400 transition-colors">
            <span>←</span><span>返回首页</span>
          </a>
        </div>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span>📦</span>
            <span>模版库</span>
            {templates.length > 0 && (
              <span className="text-sm bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                {templates.length}
              </span>
            )}
          </h1>
          <button
            onClick={openCreateForm}
            className="text-sm px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 transition-colors font-medium"
          >
            ＋ 新建模版
          </button>
        </div>

        {/* Search + Category Filter */}
        <div className="mb-5 space-y-3">
          <input
            type="text"
            placeholder="搜索模版..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`text-xs px-3 py-1.5 rounded-full transition-all ${
                  category === cat.value
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300 border border-slate-700'
                }`}
              >
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 二级筛选：模式 + 可见性 */}
        <div className="mb-5 flex gap-4 flex-wrap items-center">
          {/* 单人/团队 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">模式</span>
            {([
              { value: 'all', label: '全部' },
              { value: 'solo', label: '👤 单人' },
              { value: 'team', label: '👥 团队' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilterMode(opt.value)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-all border ${
                  filterMode === opt.value
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                    : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-700" />

          {/* 可见性 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">范围</span>
            {([
              { value: 'all', label: '全部' },
              { value: 'public', label: '🌐 公开' },
              { value: 'workspace', label: '🏢 工作区' },
              { value: 'private', label: '🔒 私有' },
              { value: 'draft', label: '✏️ 草稿' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilterVis(opt.value)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-all border ${
                  filterVis === opt.value
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Template Grid */}
        {(() => {
          const filtered = templates.filter(t => {
            if (filterMode === 'solo' && t.defaultMode !== 'solo') return false
            if (filterMode === 'team' && t.defaultMode !== 'team') return false
            if (filterVis === 'draft') return t.isDraft
            if (filterVis === 'public') return !t.isDraft && (t.visibility === 'public' || t.isPublic)
            if (filterVis === 'workspace') return !t.isDraft && t.visibility === 'workspace'
            if (filterVis === 'private') return !t.isDraft && t.visibility === 'private'
            return true
          })
          const totalShown = filtered.length
          return <>
          {/* 显示筛选结果计数 */}
          {(filterMode !== 'all' || filterVis !== 'all') && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-500">筛选结果：{totalShown} 个模版</span>
              <button
                onClick={() => { setFilterMode('all'); setFilterVis('all') }}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:text-orange-400 transition-colors"
              >
                清除筛选
              </button>
            </div>
          )}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📦</div>
            <p className="text-slate-400 text-sm">
              {search || category !== 'all' || filterMode !== 'all' || filterVis !== 'all' ? '没有找到匹配的模版' : '还没有模版'}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Agent 会在完成任务后自动创建可复用的模版
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(t => {
              const tags = parseTags(t.tags)
              const steps = parseSteps(t.stepsTemplate)
              const catInfo = CATEGORIES.find(c => c.value === t.category) || CATEGORIES[1]
              return (
                <div
                  key={t.id}
                  onClick={() => openTemplate(t)}
                  className="bg-slate-800 rounded-2xl border border-slate-700 p-4 cursor-pointer hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/5 transition-all group"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center text-xl shrink-0 group-hover:bg-orange-500/20 transition-colors">
                      {t.icon || catInfo.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-white truncate group-hover:text-orange-400 transition-colors flex items-center gap-1.5">
                        {t.isDraft && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-normal shrink-0">草稿</span>
                        )}
                        {t.name}
                      </h3>
                      {t.description && (
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{t.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                      {steps.length} 步骤
                    </span>
                    {t.useCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                        已用 {t.useCount} 次
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      t.defaultMode === 'team' ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {t.defaultMode === 'team' ? '团队' : '单人'}
                    </span>
                    {/* 可见性图标 */}
                    {(() => {
                      const vis = t.visibility || (t.isPublic ? 'public' : 'workspace')
                      const opt = VISIBILITY_OPTIONS.find(o => o.value === vis)
                      return opt ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400" title={opt.desc}>
                          {opt.icon} {opt.label}
                        </span>
                      ) : null
                    })()}
                    {t.schedule && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                        定时
                      </span>
                    )}
                    {tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {t.creator && (
                    <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-500">
                      <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-[8px] font-bold">
                        {t.creator.name?.[0] || '?'}
                      </div>
                      <span>{t.creator.agent?.name ? `${t.creator.agent.name} · ${t.creator.name}` : t.creator.name || 'Agent'} 创建</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
          </>
        })()}
      </div>

      {/* Template Detail / Run Modal */}
      {selectedTemplate && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => { setSelectedTemplate(null); setRunResult(null) }}
        >
          <div
            className="bg-slate-800 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl border-t sm:border border-slate-700 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {runResult ? (
              /* 成功结果 */
              <div className="p-6 text-center">
                <div className="text-4xl mb-3">🎉</div>
                <h3 className="text-lg font-bold text-white mb-2">任务创建成功</h3>
                <p className="text-sm text-slate-400 mb-1">{runResult.title}</p>
                <p className="text-xs text-slate-500 mb-4">
                  共 {runResult.stepsCreated} 个步骤
                  {runResult.pendingInviteCount ? `，${runResult.pendingInviteCount} 个步骤等待邀请方加入` : '，已通知 Agent'}
                </p>
                {runResult.inviteLinks && runResult.inviteLinks.length > 0 && (
                  <div className="mb-5 text-left space-y-2">
                    <p className="text-xs text-slate-400 font-medium mb-2">邀请链接（发给对方，接受后自动分配步骤）</p>
                    {runResult.inviteLinks.map(link => (
                      <div key={link.role} className="bg-slate-700 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-1.5">{link.label}（{link.role}）</p>
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            value={link.url}
                            className="flex-1 bg-slate-600 text-[11px] text-white px-2 py-1.5 rounded-lg focus:outline-none"
                          />
                          <button
                            onClick={() => navigator.clipboard.writeText(link.url)}
                            className="text-[11px] px-2.5 py-1.5 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors shrink-0"
                          >
                            复制
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => { setSelectedTemplate(null); setRunResult(null) }}
                    className="text-sm px-4 py-2 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    返回模版库
                  </button>
                  <button
                    onClick={() => router.push(`/?task=${runResult.taskId}`)}
                    className="text-sm px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 transition-colors"
                  >
                    查看任务
                  </button>
                </div>
              </div>
            ) : (
              /* 模版详情 + 变量表单 */
              <>
                <div className="p-5 border-b border-slate-700">
                  {/* Admin 管理栏 */}
                  {isAdmin && !isOwnTemplate && (
                    <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                      <span className="text-xs text-violet-400 font-medium">
                        {isSuperAdmin ? '🛡️ 超级管理员' : '🔑 工作区管理员'}
                      </span>
                      <span className="text-xs text-slate-500">— 可删除、切换草稿</span>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center text-2xl shrink-0">
                      {selectedTemplate.icon || '📦'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold text-white">{selectedTemplate.name}</h2>
                      {selectedTemplate.description && (
                        <p className="text-sm text-slate-400 mt-1">{selectedTemplate.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                        <span>已使用 {selectedTemplate.useCount} 次</span>
                        <span>|</span>
                        <span>{parseSteps(selectedTemplate.stepsTemplate).length} 个步骤</span>
                        {selectedTemplate.creator && (
                          <>
                            <span>|</span>
                            <span>{selectedTemplate.creator.agent?.name ? `${selectedTemplate.creator.agent.name} · ${selectedTemplate.creator.name}` : selectedTemplate.creator.name || 'Agent'} 创建</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 步骤预览 */}
                <div className="px-5 py-4 border-b border-slate-700">
                  <h4 className="text-xs font-medium text-slate-400 mb-2">步骤流程</h4>
                  <div className="space-y-1.5">
                    {parseSteps(selectedTemplate.stepsTemplate).map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center text-[10px] shrink-0">
                          {s.order || i + 1}
                        </span>
                        <span className="text-slate-300">{s.title}</span>
                        {s.assigneeRole && (
                          <span className={`px-1 py-0.5 rounded text-[10px] ${
                            s.assigneeRole === 'agent' ? 'bg-blue-500/20 text-blue-400'
                            : s.assigneeRole === 'sub-agent' ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {s.assigneeRole === 'agent' ? 'Agent'
                              : s.assigneeRole === 'sub-agent' ? '子Agent'
                              : '人类'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 变量表单 */}
                {(() => {
                  const vars = parseVariables(selectedTemplate.variables)
                  // 过滤掉已由"参与方"orgName管理的变量（如 party-a、party-b），避免重复填写
                  const partyRoles = new Set(parties.map(p => p.role))
                  // 同时过滤掉 label 或 name 与参与方相关的变量（如"甲方名称"、"乙方名称"）
                  const partyRelatedNames = new Set(parties.flatMap(p => [p.label, `${p.label}名称`, p.role]))
                  const visibleVars = vars.filter(v => !partyRoles.has(v.name) && !partyRelatedNames.has(v.name) && !partyRelatedNames.has(v.label))
                  if (visibleVars.length === 0) return null
                  return (
                    <div className="px-5 py-4 border-b border-slate-700">
                      <h4 className="text-xs font-medium text-slate-400 mb-3">自定义参数</h4>
                      <div className="space-y-3">
                        {visibleVars.map(v => (
                          <div key={v.name}>
                            <label className="text-xs text-slate-300 mb-1 block">
                              {v.label || v.name}
                              {v.required && <span className="text-red-400 ml-0.5">*</span>}
                            </label>
                            {v.description && (
                              <p className="text-[10px] text-slate-500 mb-1">{v.description}</p>
                            )}
                            {v.type === 'select' && v.options ? (
                              <select
                                value={variableValues[v.name] || ''}
                                onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                              >
                                <option value="">请选择</option>
                                {v.options.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : v.type === 'date' ? (
                              <input
                                type="date"
                                value={variableValues[v.name] || ''}
                                onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                              />
                            ) : v.type === 'number' ? (
                              <input
                                type="number"
                                value={variableValues[v.name] || ''}
                                onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                                placeholder={v.default?.toString() || ''}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                              />
                            ) : (
                              <input
                                type="text"
                                value={variableValues[v.name] || ''}
                                onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                                placeholder={v.default?.toString() || ''}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* 参与方设置（Team 模版或有 partyRole 步骤时显示） */}
                {parties.length > 0 && (
                  <div className="px-5 py-4 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-medium text-slate-400">参与方设置</h4>
                      <span className="text-[10px] text-slate-500">每方可以是你/AI模拟/真人邀请</span>
                    </div>
                    <div className="space-y-3">
                      {parties.map((p, idx) => (
                        <div key={p.role} className="bg-slate-750 rounded-xl border border-slate-700 p-3 space-y-2">
                          {/* 头部：角色标签 + 名称 + 删除（非 party-a 可删） */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 shrink-0 font-mono">
                              {p.role}
                            </span>
                            <input
                              type="text"
                              value={p.label}
                              onChange={e => setParties(prev => prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                              placeholder="角色名称"
                              disabled={p.role === 'party-a'}
                              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none disabled:text-slate-500"
                            />
                            {p.role !== 'party-a' && (
                              <button
                                onClick={() => setParties(prev => prev.filter((_, i) => i !== idx))}
                                className="text-slate-600 hover:text-red-400 transition-colors text-xs"
                              >✕</button>
                            )}
                          </div>

                          {/* 绑定类型选择 */}
                          <div className="flex gap-1.5 flex-wrap">
                            {(p.role === 'party-a'
                              ? [{ v: 'self' as const, label: '就是我' }]
                              : [
                                  { v: 'simulate' as const, label: '🤖 AI模拟' },
                                  { v: 'invite' as const, label: '🔗 邀请真人' },
                                ]
                            ).map(opt => (
                              <button
                                key={opt.v}
                                onClick={() => p.role !== 'party-a' && setParties(prev => prev.map((x, i) => i === idx ? { ...x, bindType: opt.v } : x))}
                                disabled={p.role === 'party-a'}
                                className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors disabled:cursor-default ${
                                  p.bindType === opt.v
                                    ? 'bg-orange-500/30 text-orange-400 border border-orange-500/50'
                                    : 'bg-slate-700 text-slate-400 hover:text-slate-300 border border-transparent'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          {/* self: 输入组织名（用于步骤标题显示） */}
                          {p.bindType === 'self' && (
                            <input
                              type="text"
                              value={p.orgName}
                              onChange={e => { setParties(prev => prev.map((x, i) => i === idx ? { ...x, orgName: e.target.value } : x)); setVariableValues(prev => ({ ...prev, [p.role]: e.target.value })) }}
                              placeholder="你的组织/公司名（步骤中显示，如'清华大学'）"
                              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                            />
                          )}

                          {/* simulate: 输入名称 + 资料链接 */}
                          {p.bindType === 'simulate' && (
                            <div className="space-y-1.5 pt-0.5">
                              <input
                                type="text"
                                value={p.orgName}
                                onChange={e => { setParties(prev => prev.map((x, i) => i === idx ? { ...x, orgName: e.target.value } : x)); setVariableValues(prev => ({ ...prev, [p.role]: e.target.value })) }}
                                placeholder={`${p.label}的名称（如"某护工公司"）`}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                              />
                              <input
                                type="text"
                                value={p.materials}
                                onChange={e => setParties(prev => prev.map((x, i) => i === idx ? { ...x, materials: e.target.value } : x))}
                                placeholder="参考资料 URL（多个用逗号分隔，可选）"
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                              />
                            </div>
                          )}

                          {/* invite: 提示文字 */}
                          {p.bindType === 'invite' && (
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <input
                                type="text"
                                value={p.orgName}
                                onChange={e => { setParties(prev => prev.map((x, i) => i === idx ? { ...x, orgName: e.target.value } : x)); setVariableValues(prev => ({ ...prev, [p.role]: e.target.value })) }}
                                placeholder={`${p.label}的名称（用于步骤标题显示）`}
                                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                              />
                              <span className="text-[10px] text-slate-500 shrink-0">发布后生成邀请链接</span>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* 添加参与方按钮 */}
                      <button
                        onClick={() => {
                          const role = nextPartyRole(parties)
                          setParties(prev => [...prev, {
                            role,
                            label: PARTY_LABELS[role] || `第${prev.length + 1}方`,
                            bindType: 'simulate',
                            orgName: '',
                            materials: '',
                          }])
                        }}
                        className="w-full text-xs py-2 rounded-xl border border-dashed border-slate-600 text-slate-500 hover:border-orange-500/50 hover:text-orange-400 transition-colors"
                      >
                        ＋ 添加参与方
                      </button>
                    </div>
                  </div>
                )}

                {/* 可见性设置（创建者或管理员可操作） */}
                {canManage && (
                  <div className="px-5 py-3 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400 font-medium">可见性</span>
                      <span className="text-[10px] text-slate-500">
                        {VISIBILITY_OPTIONS.find(o => o.value === visibility)?.desc}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {VISIBILITY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => updateVisibility(opt.value)}
                          className={`flex-1 text-[11px] py-1.5 rounded-lg transition-colors border ${
                            visibility === opt.value
                              ? 'bg-orange-500/20 text-orange-400 border-orange-500/40'
                              : 'bg-slate-700 text-slate-400 border-transparent hover:text-slate-300'
                          }`}
                        >
                          {opt.icon} {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 草稿状态提示 */}
                {selectedTemplate.isDraft && (
                  <div className="px-5 py-3 bg-yellow-500/10 border-b border-yellow-500/20 flex items-center justify-between">
                    <span className="text-xs text-yellow-400">草稿模版 — 仅你和管理员可见</span>
                    {canManage && (
                      <button
                        onClick={toggleDraft}
                        disabled={publishing}
                        className="text-xs px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {publishing ? '发布中...' : '发布'}
                      </button>
                    )}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="p-5 flex gap-3">
                  <button
                    onClick={() => { setSelectedTemplate(null); setRunResult(null) }}
                    className="flex-1 text-sm py-2.5 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    关闭
                  </button>
                  {canManage && (
                    <button
                      onClick={() => openEditForm(selectedTemplate)}
                      className="text-xs px-3 py-2.5 rounded-xl bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                    >
                      编辑
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={deleteTemplate}
                      disabled={deleting}
                      className="text-xs px-3 py-2.5 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      {deleting ? '删除中...' : '删除'}
                    </button>
                  )}
                  {canManage && !selectedTemplate.isDraft && (
                    <button
                      onClick={toggleDraft}
                      disabled={publishing}
                      className="text-xs px-3 py-2.5 rounded-xl bg-slate-700 text-yellow-400 hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                      撤为草稿
                    </button>
                  )}
                  <button
                    onClick={runTemplate}
                    disabled={running}
                    className="flex-1 text-sm py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 transition-colors disabled:opacity-50 font-medium"
                  >
                    {running ? '创建中...' : '发布任务'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 创建/编辑模版 Modal */}
      {editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
              <h2 className="text-base font-semibold text-white">
                {editMode === 'create' ? '新建模版' : '编辑模版'}
              </h2>
              <button
                onClick={() => setEditMode(null)}
                className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
              >×</button>
            </div>

            {/* 表单内容（可滚动） */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {/* 名称 + 图标 */}
              <div className="flex gap-3">
                <div className="w-20 shrink-0">
                  <label className="block text-xs text-slate-400 mb-1">图标</label>
                  <input
                    type="text"
                    placeholder="📋"
                    value={formData.icon}
                    onChange={e => setFormData(f => ({ ...f, icon: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-center text-xl text-white focus:outline-none focus:border-orange-500 transition-colors"
                    maxLength={4}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">名称 <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    placeholder="模版名称"
                    value={formData.name}
                    onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                </div>
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">描述</label>
                <textarea
                  placeholder="简要描述这个模版的用途..."
                  value={formData.description}
                  onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors resize-none"
                />
              </div>

              {/* 分类 + 模式 */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">分类</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
                  >
                    {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                      <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">模式</label>
                  <div className="flex gap-2">
                    {(['solo', 'team'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setFormData(f => ({ ...f, defaultMode: m }))}
                        className={`flex-1 text-sm py-2 rounded-xl border transition-all ${
                          formData.defaultMode === m
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-300'
                        }`}
                      >
                        {m === 'solo' ? '👤 单人' : '👥 团队'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 可见性 + 草稿 */}
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">可见性</label>
                  <div className="flex gap-2">
                    {VISIBILITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setFormData(f => ({ ...f, visibility: opt.value }))}
                        className={`flex-1 text-xs py-2 rounded-xl border transition-all ${
                          formData.visibility === opt.value
                            ? 'bg-orange-500/20 text-orange-400 border-orange-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-300'
                        }`}
                      >
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={formData.isDraft}
                    onChange={e => setFormData(f => ({ ...f, isDraft: e.target.checked }))}
                    className="accent-orange-500"
                  />
                  存为草稿
                </label>
              </div>

              {/* 步骤 JSON */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  步骤 (JSON) <span className="text-red-400">*</span>
                  <span className="ml-2 text-slate-600">每个步骤: &#123; order, title, description?, assigneeRole?, requiresApproval? &#125;</span>
                </label>
                <textarea
                  value={formData.stepsTemplate}
                  onChange={e => setFormData(f => ({ ...f, stepsTemplate: e.target.value }))}
                  rows={8}
                  spellCheck={false}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-300 font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors resize-y"
                />
              </div>

              {/* 变量 JSON */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  变量 (JSON, 可选)
                  <span className="ml-2 text-slate-600">每个变量: &#123; name, label, type, required? &#125;</span>
                </label>
                <textarea
                  value={formData.variables}
                  onChange={e => setFormData(f => ({ ...f, variables: e.target.value }))}
                  rows={4}
                  spellCheck={false}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-blue-300 font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors resize-y"
                />
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="px-5 py-4 border-t border-slate-700 flex gap-3 shrink-0">
              <button
                onClick={() => setEditMode(null)}
                className="flex-1 text-sm py-2.5 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveTemplate}
                disabled={saving}
                className="flex-1 text-sm py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 transition-colors font-medium disabled:opacity-50"
              >
                {saving ? '保存中...' : editMode === 'create' ? '创建模版' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

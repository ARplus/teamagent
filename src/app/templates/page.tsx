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
  useCount: number
  lastUsedAt: string | null
  createdAt: string
  creator?: { id: string; name: string | null; avatar: string | null }
  _count?: { instances: number }
}

interface VariableDef {
  name: string
  label: string
  type: 'string' | 'number' | 'date' | 'select'
  required?: boolean
  default?: any
  description?: string
  options?: string[]
}

interface StepTpl {
  order: number
  title: string
  description?: string
  assigneeRole?: string
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
  const [runResult, setRunResult] = useState<{ taskId: string; title: string; stepsCreated: number } | null>(null)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
  }, [authStatus, router])

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
    // 预填默认值
    const vars = parseVariables(t.variables)
    const defaults: Record<string, any> = {}
    vars.forEach(v => {
      if (v.default !== undefined) defaults[v.name] = v.default
    })
    setVariableValues(defaults)
  }

  const runTemplate = async () => {
    if (!selectedTemplate) return
    setRunning(true)
    try {
      const res = await fetch(`/api/templates/${selectedTemplate.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: variableValues }),
      })
      const data = await res.json()
      if (res.ok) {
        setRunResult(data)
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
      <div className="max-w-4xl mx-auto px-4 py-6">
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

        {/* Template Grid */}
        {templates.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📦</div>
            <p className="text-slate-400 text-sm">
              {search || category !== 'all' ? '没有找到匹配的模版' : '还没有模版'}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Agent 会在完成任务后自动创建可复用的模版
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map(t => {
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
                      <h3 className="text-sm font-semibold text-white truncate group-hover:text-orange-400 transition-colors">
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
                      <span>{t.creator.name || 'Agent'} 创建</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
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
                <p className="text-xs text-slate-500 mb-5">
                  共 {runResult.stepsCreated} 个步骤，已通知 Agent
                </p>
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
                            <span>{selectedTemplate.creator.name || 'Agent'} 创建</span>
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
                            s.assigneeRole === 'agent' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {s.assigneeRole === 'agent' ? 'Agent' : '人类'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 变量表单 */}
                {(() => {
                  const vars = parseVariables(selectedTemplate.variables)
                  if (vars.length === 0) return null
                  return (
                    <div className="px-5 py-4 border-b border-slate-700">
                      <h4 className="text-xs font-medium text-slate-400 mb-3">自定义参数</h4>
                      <div className="space-y-3">
                        {vars.map(v => (
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

                {/* 操作按钮 */}
                <div className="p-5 flex gap-3">
                  <button
                    onClick={() => { setSelectedTemplate(null); setRunResult(null) }}
                    className="flex-1 text-sm py-2.5 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    取消
                  </button>
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
    </div>
  )
}

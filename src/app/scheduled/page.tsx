'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

interface ScheduledTemplate {
  id: string
  title: string
  description: string | null
  schedule: string
  timezone: string
  enabled: boolean
  approvalMode: string
  lastRunAt: string | null
  nextRunAt: string | null
  runCount: number
  failCount: number
  createdAt: string
  creator?: { id: string; name: string | null; avatar: string | null }
  _count?: { instances: number }
  // 展开后填充
  instances?: {
    id: string
    title: string
    status: string
    instanceNumber: number | null
    createdAt: string
  }[]
}

function describeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return schedule
  const [minStr, hourStr, domStr, , dowStr] = parts
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
  const min = minStr.padStart(2, '0')
  const hour = hourStr.padStart(2, '0')
  const time = hourStr !== '*' && minStr !== '*' ? `${hour}:${min}` : ''
  if (hourStr.startsWith('*/')) return `每 ${hourStr.slice(2)} 小时`
  if (domStr === '*' && dowStr === '*' && time) return `每天 ${time}`
  if (domStr === '*' && dowStr !== '*' && time) return `每周${WEEKDAYS[parseInt(dowStr)]} ${time}`
  if (domStr !== '*' && dowStr === '*' && time) return `每月 ${domStr} 号 ${time}`
  return schedule
}

function formatTime(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'done': return '✅'
    case 'in_progress': return '🔵'
    case 'failed': return '❌'
    default: return '⏳'
  }
}

export default function ScheduledPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [templates, setTemplates] = useState<ScheduledTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
  }, [authStatus, router])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
      }
    } catch (e) {
      console.error('获取定时模板失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    // 加载详情（含执行历史）
    try {
      const res = await fetch(`/api/scheduled/${id}`)
      if (res.ok) {
        const detail = await res.json()
        setTemplates(prev => prev.map(t => t.id === id ? { ...t, instances: detail.instances } : t))
      }
    } catch (e) {
      console.error('获取模板详情失败:', e)
    }
  }

  const handleAction = async (id: string, action: 'run' | 'pause' | 'resume' | 'delete') => {
    if (action === 'delete' && !confirm('确认删除该定时任务？已执行的任务不会被删除。')) return

    setActionLoading(`${id}-${action}`)
    try {
      const url = action === 'delete'
        ? `/api/scheduled/${id}`
        : `/api/scheduled/${id}/${action}`
      const method = action === 'delete' ? 'DELETE' : 'POST'
      const res = await fetch(url, { method })
      if (res.ok) {
        await fetchTemplates()
      } else {
        const data = await res.json()
        alert(data.error || '操作失败')
      }
    } catch (e) {
      console.error('操作失败:', e)
    } finally {
      setActionLoading(null)
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-orange-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span>⏰</span>
            <span>定时任务</span>
            {templates.length > 0 && (
              <span className="text-sm bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                {templates.length}
              </span>
            )}
          </h1>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-slate-400 text-sm">还没有定时任务</p>
            <p className="text-slate-500 text-xs mt-1">完成一个任务后，点击「保存为定时任务」即可创建</p>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                {/* 卡片头部 */}
                <div
                  className="p-4 cursor-pointer hover:bg-slate-750 transition-colors"
                  onClick={() => toggleExpand(t.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full ${t.enabled ? 'bg-emerald-400' : 'bg-yellow-400'}`} />
                        <h3 className="text-sm font-medium text-white truncate">{t.title}</h3>
                        <span className="text-xs text-slate-400 shrink-0">
                          {describeCron(t.schedule)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>上次: {formatTime(t.lastRunAt)}{t.lastRunAt ? ' ✅' : ''}</span>
                        <span>下次: {t.enabled ? formatTime(t.nextRunAt) : '--'}</span>
                        <span>
                          已执行 {t.runCount} 次
                          {t.failCount > 0 && <span className="text-red-400"> | 失败 {t.failCount} 次</span>}
                        </span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${
                      t.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {t.enabled ? '运行中' : '已暂停'}
                    </span>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-2 mt-3">
                    {t.enabled ? (
                      <button
                        onClick={e => { e.stopPropagation(); handleAction(t.id, 'pause') }}
                        disabled={actionLoading === `${t.id}-pause`}
                        className="text-xs px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-50"
                      >
                        ⏸ 暂停
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); handleAction(t.id, 'resume') }}
                        disabled={actionLoading === `${t.id}-resume`}
                        className="text-xs px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        ▶ 恢复
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); handleAction(t.id, 'run') }}
                      disabled={actionLoading === `${t.id}-run`}
                      className="text-xs px-3 py-1 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === `${t.id}-run` ? '执行中...' : '▶ 立即执行'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleAction(t.id, 'delete') }}
                      disabled={actionLoading === `${t.id}-delete`}
                      className="text-xs px-3 py-1 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 ml-auto"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* 展开的执行历史 */}
                {expandedId === t.id && (
                  <div className="border-t border-slate-700 px-4 py-3 bg-slate-850">
                    <h4 className="text-xs font-medium text-slate-400 mb-2">执行历史</h4>
                    {!t.instances ? (
                      <div className="text-xs text-slate-500 py-2">加载中...</div>
                    ) : t.instances.length === 0 ? (
                      <div className="text-xs text-slate-500 py-2">暂无执行记录</div>
                    ) : (
                      <div className="space-y-1">
                        {t.instances.map(inst => (
                          <div
                            key={inst.id}
                            className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-slate-700/50 cursor-pointer"
                            onClick={() => router.push(`/?task=${inst.id}`)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">#{inst.instanceNumber || '?'}</span>
                              <span className="text-slate-400">{formatTime(inst.createdAt)}</span>
                              <span>{statusIcon(inst.status)}</span>
                              <span className="text-slate-300">{inst.status === 'done' ? '完成' : inst.status === 'in_progress' ? '执行中' : inst.status}</span>
                            </div>
                            <span className="text-slate-600 hover:text-orange-400">查看 →</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

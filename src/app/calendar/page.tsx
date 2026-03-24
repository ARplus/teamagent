'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// 颜色配置
const COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  orange: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', dot: 'bg-orange-500' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', dot: 'bg-blue-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', dot: 'bg-rose-500' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', dot: 'bg-purple-500' },
}

type ScheduleEvent = {
  id: string
  title: string
  description?: string | null
  emoji?: string | null
  startAt: string
  endAt?: string | null
  allDay: boolean
  remindAt?: string | null
  color?: string | null
  taskId?: string | null
  task?: { id: string; title: string; status: string } | null
  source: string
  voiceText?: string | null
  status: string
}

// 工具函数
function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}

function isToday(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

function isTomorrow(dateStr: string) {
  const d = new Date(dateStr)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return d.toDateString() === tomorrow.toDateString()
}

function getDayLabel(dateStr: string) {
  if (isToday(dateStr)) return '今天'
  if (isTomorrow(dateStr)) return '明天'
  return formatDate(dateStr)
}

// 按日期分组
function groupByDate(events: ScheduleEvent[]) {
  const groups: { date: string; label: string; events: ScheduleEvent[] }[] = []
  for (const event of events) {
    const dateKey = new Date(event.startAt).toDateString()
    const existing = groups.find(g => g.date === dateKey)
    if (existing) {
      existing.events.push(event)
    } else {
      groups.push({ date: dateKey, label: getDayLabel(event.startAt), events: [event] })
    }
  }
  return groups
}

export default function CalendarPage() {
  const { status: authStatus } = useSession()
  const router = useRouter()
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // 语音录入
  const [isListening, setIsListening] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const recognitionRef = useRef<any>(null)

  // 创建表单
  const [form, setForm] = useState({
    title: '',
    emoji: '📅',
    startDate: '',
    startTime: '09:00',
    allDay: false,
    remindBefore: '30',
    color: 'orange',
    description: '',
  })

  // Auth redirect
  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
  }, [authStatus, router])

  // 加载日程
  const loadEvents = useCallback(async () => {
    try {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const to = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString()
      const res = await fetch(`/api/schedule?from=${from}&to=${to}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events || [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadEvents() }, [loadEvents])

  // 语音识别
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('您的浏览器不支持语音识别，请使用 Chrome 或 Safari')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('')
      setVoiceText(transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    setVoiceText('')
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }

  // 语音创建日程
  const createFromVoice = async () => {
    if (!voiceText.trim()) return
    try {
      const res = await fetch('/api/schedule/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceText }),
      })
      if (res.ok) {
        setVoiceText('')
        loadEvents()
      }
    } catch {}
  }

  // 手动创建日程
  const createEvent = async () => {
    if (!form.title.trim()) return
    const startAt = form.allDay
      ? new Date(form.startDate + 'T00:00:00').toISOString()
      : new Date(form.startDate + 'T' + form.startTime + ':00').toISOString()

    let remindAt = null
    if (form.remindBefore !== 'none') {
      const mins = parseInt(form.remindBefore)
      remindAt = new Date(new Date(startAt).getTime() - mins * 60 * 1000).toISOString()
    }

    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          emoji: form.emoji,
          startAt,
          allDay: form.allDay,
          remindAt,
          color: form.color,
          description: form.description || null,
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setForm({ title: '', emoji: '📅', startDate: '', startTime: '09:00', allDay: false, remindBefore: '30', color: 'orange', description: '' })
        loadEvents()
      }
    } catch {}
  }

  // 完成/取消日程
  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadEvents()
    } catch {}
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="animate-pulse text-slate-400 text-lg">加载日程中...</div>
      </div>
    )
  }

  const groups = groupByDate(events)
  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              📅 <span>日程表</span>
            </h1>
          </div>
          <button
            onClick={() => { setShowCreate(!showCreate); setForm(f => ({ ...f, startDate: todayStr })) }}
            className="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold rounded-xl hover:from-orange-400 hover:to-rose-400 transition shadow-lg shadow-orange-500/20"
          >
            + 新日程
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-32 space-y-4">
        {/* 语音录入区 */}
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/50 p-4">
          <p className="text-xs text-slate-400 mb-2">🎤 语音创建日程</p>
          <div className="flex items-center gap-2">
            <button
              onClick={isListening ? stopListening : startListening}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${
                isListening
                  ? 'bg-red-500 shadow-red-500/30 animate-pulse scale-110'
                  : 'bg-gradient-to-br from-orange-500 to-rose-500 shadow-orange-500/20 hover:scale-105'
              }`}
            >
              <span className="text-xl">{isListening ? '⏹️' : '🎙️'}</span>
            </button>
            <div className="flex-1">
              {isListening ? (
                <div className="text-orange-400 text-sm animate-pulse">🔴 正在聆听...</div>
              ) : voiceText ? (
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm flex-1 truncate">&ldquo;{voiceText}&rdquo;</p>
                  <button
                    onClick={createFromVoice}
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold rounded-lg transition"
                  >
                    ✓ 创建
                  </button>
                  <button onClick={() => setVoiceText('')} className="text-slate-400 hover:text-white text-xs">✕</button>
                </div>
              ) : (
                <p className="text-slate-500 text-sm">试试说：&ldquo;明天下午3点开会&rdquo; 或 &ldquo;周五提醒我交报告&rdquo;</p>
              )}
            </div>
          </div>
        </div>

        {/* 手动创建表单 */}
        {showCreate && (
          <div className="bg-slate-800/80 rounded-2xl border border-orange-500/20 p-4 space-y-3 shadow-lg shadow-orange-500/5">
            <div className="flex items-center gap-2">
              <span className="text-lg">{form.emoji}</span>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="日程标题..."
                className="flex-1 bg-transparent text-white text-sm font-medium outline-none placeholder:text-slate-500"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-400 block mb-1">日期</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                  className="w-full bg-slate-700/50 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600/50 outline-none focus:border-orange-500/50"
                />
              </div>
              {!form.allDay && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">时间</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full bg-slate-700/50 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600/50 outline-none focus:border-orange-500/50"
                  />
                </div>
              )}
            </div>

            {/* Emoji 选择 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">图标</label>
              <div className="flex gap-1.5 flex-wrap">
                {['📅', '🗓️', '🍽️', '🏃', '💼', '📞', '🎂', '📝', '💻', '🤝', '📚', '✈️', '🏥', '📦'].map(e => (
                  <button
                    key={e}
                    onClick={() => setForm(f => ({ ...f, emoji: e }))}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition ${form.emoji === e ? 'bg-orange-500/20 ring-1 ring-orange-500' : 'hover:bg-slate-700'}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* 颜色 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">颜色</label>
              <div className="flex gap-2">
                {Object.entries(COLORS).map(([key, c]) => (
                  <button
                    key={key}
                    onClick={() => setForm(f => ({ ...f, color: key }))}
                    className={`w-6 h-6 rounded-full ${c.dot} transition ${form.color === key ? 'ring-2 ring-offset-2 ring-offset-slate-800 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
                  />
                ))}
              </div>
            </div>

            {/* 提醒 */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">提醒</label>
              <select
                value={form.remindBefore}
                onChange={e => setForm(f => ({ ...f, remindBefore: e.target.value }))}
                className="bg-slate-700/50 text-white text-xs rounded-lg px-2 py-1 border border-slate-600/50 outline-none"
              >
                <option value="none">不提醒</option>
                <option value="5">5 分钟前</option>
                <option value="15">15 分钟前</option>
                <option value="30">30 分钟前</option>
                <option value="60">1 小时前</option>
                <option value="1440">1 天前</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-400 ml-auto">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))}
                  className="rounded border-slate-600"
                />
                全天
              </label>
            </div>

            {/* 描述 */}
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="备注（可选）"
              rows={2}
              className="w-full bg-slate-700/50 text-white text-sm rounded-lg px-3 py-2 border border-slate-600/50 outline-none focus:border-orange-500/50 placeholder:text-slate-500 resize-none"
            />

            {/* 按钮 */}
            <div className="flex gap-2">
              <button
                onClick={createEvent}
                disabled={!form.title.trim() || !form.startDate}
                className="flex-1 py-2 bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold rounded-xl hover:from-orange-400 hover:to-rose-400 disabled:opacity-40 transition shadow-md"
              >
                ✓ 创建日程
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-slate-400 hover:text-white text-sm rounded-xl hover:bg-slate-700/50 transition"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 日程列表（按天分组） */}
        {groups.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3 opacity-50">📅</div>
            <p className="text-slate-400 text-lg font-medium">暂无日程</p>
            <p className="text-slate-500 text-sm mt-1">点击 &ldquo;+ 新日程&rdquo; 或用语音创建</p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.date}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-bold ${group.label === '今天' ? 'text-orange-400' : 'text-slate-400'}`}>
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-xs text-slate-500">{group.events.length} 项</span>
              </div>
              <div className="space-y-2">
                {group.events.map(event => {
                  const c = COLORS[event.color || 'orange'] || COLORS.orange
                  return (
                    <div
                      key={event.id}
                      className={`flex items-start gap-3 rounded-xl px-4 py-3 border transition-all ${c.bg} ${c.border} ${
                        event.status === 'completed' ? 'opacity-50' : 'hover:shadow-md'
                      }`}
                    >
                      {/* 时间 */}
                      <div className="w-12 text-center shrink-0 pt-0.5">
                        {event.allDay ? (
                          <span className="text-xs text-slate-400">全天</span>
                        ) : (
                          <span className={`text-sm font-bold ${c.text}`}>{formatTime(event.startAt)}</span>
                        )}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{event.emoji || '📅'}</span>
                          <h3 className={`text-sm font-medium ${event.status === 'completed' ? 'text-slate-500 line-through' : 'text-white'}`}>
                            {event.title}
                          </h3>
                          {event.remindAt && !event.status.includes('completed') && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">🔔</span>
                          )}
                          {event.source === 'voice' && (
                            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">🎙️</span>
                          )}
                        </div>
                        {event.description && (
                          <p className="text-xs text-slate-400 mt-0.5 truncate">{event.description}</p>
                        )}
                        {event.task && (
                          <Link href={`/?task=${event.task.id}`} className="text-xs text-orange-400/80 hover:text-orange-400 mt-0.5 inline-flex items-center gap-1">
                            📋 {event.task.title}
                          </Link>
                        )}
                      </div>

                      {/* 操作 */}
                      <div className="flex items-center gap-1 shrink-0">
                        {event.status !== 'completed' && (
                          <button
                            onClick={() => updateStatus(event.id, 'completed')}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition"
                            title="标记完成"
                          >
                            ✓
                          </button>
                        )}
                        <button
                          onClick={() => updateStatus(event.id, 'cancelled')}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
                          title="取消"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  )
}

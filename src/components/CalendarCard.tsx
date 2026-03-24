'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

type ScheduleEvent = {
  id: string
  title: string
  emoji?: string | null
  startAt: string
  allDay: boolean
  color?: string | null
  status: string
}

const COLOR_DOT: Record<string, string> = {
  orange: 'bg-orange-500',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  purple: 'bg-purple-500',
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function isToday(dateStr: string) {
  return new Date(dateStr).toDateString() === new Date().toDateString()
}

export function CalendarCard() {
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [voiceText, setVoiceText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [creating, setCreating] = useState(false)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const now = new Date()
        const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString()
        const res = await fetch(`/api/schedule?from=${from}&to=${to}`)
        if (res.ok) {
          const data = await res.json()
          setEvents((data.events || []).slice(0, 5)) // show max 5
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [])

  // Voice
  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join('')
      setVoiceText(transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    setVoiceText('')
  }

  const createFromVoice = async () => {
    if (!voiceText.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/schedule/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceText }),
      })
      if (res.ok) {
        const data = await res.json()
        setEvents(prev => [data.event, ...prev].slice(0, 5))
        setVoiceText('')
      }
    } catch {}
    setCreating(false)
  }

  const todayEvents = events.filter(e => isToday(e.startAt))
  const upcomingEvents = events.filter(e => !isToday(e.startAt))
  const todayDate = new Date()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][todayDate.getDay()]

  return (
    <div className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-orange-500/10 to-rose-500/10 border-b border-slate-700/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📅</span>
            <div>
              <h3 className="text-sm font-bold text-white">日程</h3>
              <p className="text-[10px] text-slate-400">
                {todayDate.getMonth() + 1}月{todayDate.getDate()}日 周{weekday}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleVoice}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
                isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-slate-400 hover:text-orange-400 hover:bg-slate-700/50'
              }`}
              title="语音录入"
            >
              🎙️
            </button>
            <Link
              href="/calendar"
              className="text-xs text-orange-400 hover:text-orange-300 font-medium"
            >
              全部 →
            </Link>
          </div>
        </div>

        {/* Voice bar */}
        {(isListening || voiceText) && (
          <div className="mt-2 flex items-center gap-2">
            {isListening ? (
              <span className="text-xs text-red-400 animate-pulse flex-1">🔴 聆听中...</span>
            ) : (
              <>
                <span className="text-xs text-white flex-1 truncate">&ldquo;{voiceText}&rdquo;</span>
                <button
                  onClick={createFromVoice}
                  disabled={creating}
                  className="text-[10px] px-2 py-0.5 bg-emerald-500 text-white rounded-md font-medium"
                >
                  {creating ? '...' : '✓ 创建'}
                </button>
                <button onClick={() => setVoiceText('')} className="text-slate-400 text-xs">✕</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Event list */}
      <div className="px-3 py-2 space-y-1 max-h-[200px] overflow-y-auto">
        {loading ? (
          <div className="text-center py-4 text-slate-500 text-xs animate-pulse">加载中...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-slate-500 text-xs">暂无近期日程</p>
            <p className="text-slate-600 text-[10px] mt-0.5">试试语音：&ldquo;明天开会&rdquo;</p>
          </div>
        ) : (
          <>
            {todayEvents.length > 0 && (
              <div className="text-[10px] text-orange-400 font-bold px-1 pt-1">今天 · {todayEvents.length} 项</div>
            )}
            {todayEvents.map(e => (
              <EventRow key={e.id} event={e} />
            ))}
            {upcomingEvents.length > 0 && (
              <div className="text-[10px] text-slate-500 font-bold px-1 pt-1">即将到来</div>
            )}
            {upcomingEvents.map(e => (
              <EventRow key={e.id} event={e} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: ScheduleEvent }) {
  const dot = COLOR_DOT[event.color || 'orange'] || COLOR_DOT.orange
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700/30 transition group">
      <span className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
      <span className="text-xs">{event.emoji || '📅'}</span>
      <span className="text-xs text-white font-medium flex-1 truncate">{event.title}</span>
      <span className="text-[10px] text-slate-500 shrink-0">
        {event.allDay ? '全天' : formatTime(event.startAt)}
      </span>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { VoiceMicButton } from '@/components/VoiceMicButton'
// useAgentEvents 不用于聊天页（避免踢掉 Agent 的 OpenClaw SSE 连接）

interface ChatAttachment {
  url: string
  name: string
  type: string
  size?: number
}

interface Message {
  id: string
  content: string
  role: 'user' | 'agent'
  createdAt: string
  pending?: boolean
  metadata?: string | Record<string, any> | null
}

interface AgentInfo {
  id: string
  name: string
  avatar?: string
  status: string
}

interface TaskStats {
  inProgress: number
  done: number
}

export default function ChatPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [typing, setTyping] = useState(false)
  const [stats, setStats] = useState<TaskStats>({ inProgress: 0, done: 0 })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const latestMsgIdRef = useRef<string | null>(null)
  const isFirstLoad = useRef(true)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)

  // 三联呼状态
  const [calling, setCalling] = useState(false)
  const [callFailed, setCallFailed] = useState(false)
  const messagesRef = useRef<Message[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])
  // 记录最后一条真实 Agent 消息的时间（用于判断 3/5 分钟超时是否应该弹出）
  const lastAgentMsgTimeRef = useRef<number>(Date.now())
  const chatFetchAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const lastReal = [...messages].reverse().find(m => m.role === 'agent' && !m.pending && !m.id.startsWith('__'))
    if (lastReal) {
      const t = new Date(lastReal.createdAt).getTime()
      if (t > lastAgentMsgTimeRef.current) lastAgentMsgTimeRef.current = t
    }
  }, [messages])

  // B13: 新建任务状态
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskMode, setNewTaskMode] = useState<'solo' | 'team'>('solo')
  const [creatingTask, setCreatingTask] = useState(false)

  // 创建日程状态
  const [showNewSchedule, setShowNewSchedule] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    title: '', emoji: '📅', startDate: '', startTime: '09:00',
    allDay: false, remindBefore: '30', color: 'orange', description: '',
  })
  const [creatingSchedule, setCreatingSchedule] = useState(false)

  // 认证检查
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?from=/chat')
    }
  }, [status, router])

  // 初始加载
  useEffect(() => {
    if (session?.user) {
      loadAll()
      // ?msg= 预填消息（来自呼叫Agent入口）
      const preMsg = new URLSearchParams(window.location.search).get('msg')
      if (preMsg) setInput(decodeURIComponent(preMsg))
    }
  }, [session])

  // 滚动到底部 — 首次加延迟确保移动端布局完成，后续用 smooth
  useEffect(() => {
    if (messages.length === 0) return
    const el = messagesEndRef.current
    if (!el) return
    if (isFirstLoad.current) {
      // 移动端首次加载需等布局稳定后再滚动
      const scrollToBottom = () => {
        el.scrollIntoView({ block: 'end' })
        isFirstLoad.current = false
      }
      requestAnimationFrame(() => setTimeout(scrollToBottom, 150))
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, typing])

  // 后台轮询：每 4 秒刷新消息
  useEffect(() => {
    if (!session?.user) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/chat/history?limit=50')
        if (!res.ok) return
        const data = await res.json()
        const newMsgs: Message[] = data.messages || []
        if (newMsgs.length === 0) return
        const latestId = newMsgs[newMsgs.length - 1].id
        if (latestId !== latestMsgIdRef.current) {
          latestMsgIdRef.current = latestId
          setMessages(newMsgs)
        }
      } catch (_) {}
    }, 4000)
    return () => clearInterval(interval)
  }, [session])

  // #3 fix: 监听 SSE chat:incoming → 立即刷新（AbortController 防竞态）
  useEffect(() => {
    const handler = async () => {
      try {
        if (chatFetchAbortRef.current) chatFetchAbortRef.current.abort()
        chatFetchAbortRef.current = new AbortController()
        const res = await fetch('/api/chat/history?limit=50', { signal: chatFetchAbortRef.current.signal })
        if (!res.ok) return
        const data = await res.json()
        const msgs: Message[] = data.messages || []
        setMessages(msgs)
        if (msgs.length > 0) latestMsgIdRef.current = msgs[msgs.length - 1].id
      } catch (e: any) {
        if (e?.name === 'AbortError') return
      }
    }
    window.addEventListener('teamagent:chat-refresh', handler)
    return () => window.removeEventListener('teamagent:chat-refresh', handler)
  }, [])

  const loadAll = async () => {
    try {
      const [agentRes, historyRes, statsRes] = await Promise.all([
        fetch('/api/agent/my'),
        fetch('/api/chat/history?limit=50'),
        fetch('/api/tasks/stats'),
      ])
      if (agentRes.ok) setAgent(await agentRes.json())
      if (historyRes.ok) {
        const data = await historyRes.json()
        const msgs: Message[] = data.messages || []
        setMessages(msgs)
        if (msgs.length > 0) latestMsgIdRef.current = msgs[msgs.length - 1].id
      }
      if (statsRes.ok) setStats(await statsRes.json())
    } catch (e) {
      console.error('loadAll error:', e)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    const newAttachments: ChatAttachment[] = []
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('上传失败')
        const data = await res.json()
        newAttachments.push({ url: data.url, name: data.filename || file.name, type: data.type || file.type, size: data.size || file.size })
      } catch (err) {
        console.error('文件上传失败:', err)
      }
    }
    setAttachments(prev => [...prev, ...newAttachments])
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const sendMessage = async (text?: string) => {
    const content = text || input.trim()
    const hasAttach = attachments.length > 0
    if ((!content && !hasAttach) || loading) return

    const currentAttachments = [...attachments]
    setAttachments([])
    setInput('')
    setLoading(true)

    const metadata = currentAttachments.length > 0 ? JSON.stringify({ attachments: currentAttachments }) : undefined

    const tempId = 'temp-' + Date.now()
    const userMsg: Message = {
      id: tempId,
      content: content || currentAttachments.map(a => a.name).join(', '),
      role: 'user',
      createdAt: new Date().toISOString(),
      metadata,
    }
    setMessages(prev => [...prev, userMsg])
    setTyping(true)

    const sendContent = content || currentAttachments.map(a => `[附件: ${a.name}](${a.url})`).join('\n')

    let pendingMode = false
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: sendContent, metadata }),
      })

      if (res.ok) {
        const data = await res.json()

        if (data.pending && data.agentMessageId) {
          pendingMode = true
          setMessages(prev => [
            ...prev.filter(m => m.id !== tempId),
            { ...userMsg, id: data.userMessageId },
            { id: data.agentMessageId, content: '...', role: 'agent' as const, createdAt: new Date().toISOString(), pending: true },
          ])
          latestMsgIdRef.current = data.agentMessageId

          // 持续轮询，不超时放弃
          let attempts = 0
          const poll = async () => {
            attempts++
            try {
              const r = await fetch(`/api/chat/poll?msgId=${data.agentMessageId}`)
              if (r.ok) {
                const d = await r.json()
                if (d.ready) {
                  setMessages(prev => prev.map(m =>
                    m.id === data.agentMessageId ? { ...d.message, role: 'agent' as const, pending: false } : m
                  ))
                  latestMsgIdRef.current = d.message.id
                  setLoading(false)
                  setTyping(false)
                  return
                }
              }
            } catch (_) {}
            setTimeout(poll, attempts < 30 ? 2000 : 5000)
          }
          poll()
        } else {
          setMessages(prev => [
            ...prev.filter(m => m.id !== tempId),
            { ...userMsg, id: data.userMessageId },
            data.agentMessage,
          ])
          latestMsgIdRef.current = data.agentMessage?.id
        }
      } else {
        const err = await res.json().catch(() => ({}))
        setMessages(prev => [...prev, {
          id: 'err-' + Date.now(),
          content: `❌ ${err.error || '发送失败，请重试'}`,
          role: 'agent' as const,
          createdAt: new Date().toISOString(),
        }])
      }
    } catch (_) {
      setMessages(prev => [...prev, {
        id: 'err-' + Date.now(),
        content: '❌ 网络错误，请重试',
        role: 'agent' as const,
        createdAt: new Date().toISOString(),
      }])
    } finally {
      if (!pendingMode) {
        setLoading(false)
        setTyping(false)
      }
    }
  }

  // 三联呼：向服务器发 agent:calling 事件，8s 内若没有新 Agent 消息则显示"Ta不在"
  const handleCallAgent = useCallback(async () => {
    if (calling) return
    setCalling(true)
    setCallFailed(false)

    // 记录当前最新的 agent 消息 id（非 pending）
    const lastAgentMsgId = [...messagesRef.current].reverse().find(m => m.role === 'agent' && !m.pending)?.id

    // 通知服务器发送 agent:calling 给 Agent 的 SSE 连接
    await fetch('/api/chat/call-agent', { method: 'POST' }).catch(() => {})

    // 等 8 秒，看 Agent 是否回复了新消息
    await new Promise(r => setTimeout(r, 8000))

    const hasNewReply = messagesRef.current.some(m =>
      m.role === 'agent' && !m.pending && m.id !== lastAgentMsgId && !m.id.startsWith('__')
    )
    if (!hasNewReply) {
      setCallFailed(true)
      setMessages(prev => [...prev, {
        id: `__call_failed_${Date.now()}`,
        content: `📵 ${agent?.name ?? 'Agent'} 是不是去摸鱼了？请给Ta三联呼！`,
        role: 'agent' as const,
        createdAt: new Date().toISOString(),
      }])
    } else {
      setCallFailed(false)
    }
    setCalling(false)
  }, [calling, agent])

  // 3 / 5 分钟任务无响应提醒
  // 只在 Agent 真的沉默（最近 3/5 分钟内没有新消息）才弹出，对话中不打扰
  useEffect(() => {
    if (stats.inProgress === 0) return
    const agentName = agent?.name ?? 'Agent'
    const t3 = setTimeout(() => {
      const silentMs = Date.now() - lastAgentMsgTimeRef.current
      if (silentMs >= 3 * 60 * 1000) {
        setMessages(prev => [...prev, {
          id: `__timeout3_${Date.now()}`,
          content: `⏱ 任务进行中已 3 分钟无响应，${agentName} 可能离线，试试右上角 📞 三联呼！`,
          role: 'agent' as const,
          createdAt: new Date().toISOString(),
        }])
      }
    }, 3 * 60 * 1000)
    const t5 = setTimeout(() => {
      const silentMs = Date.now() - lastAgentMsgTimeRef.current
      if (silentMs >= 5 * 60 * 1000) {
        setMessages(prev => [...prev, {
          id: `__timeout5_${Date.now()}`,
          content: `⚠️ 已等待 5 分钟，建议点右上角 📞 呼叫 ${agentName} 上线！`,
          role: 'agent' as const,
          createdAt: new Date().toISOString(),
        }])
      }
    }, 5 * 60 * 1000)
    return () => { clearTimeout(t3); clearTimeout(t5) }
  }, [stats.inProgress, agent?.name])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // B13: 在对话页快速新建任务
  const createTask = async () => {
    if (!newTaskDesc.trim() || creatingTask) return
    setCreatingTask(true)
    try {
      const autoTitle = newTaskTitle.trim() || newTaskDesc.trim().replace(/\s+/g, ' ').slice(0, 28)
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: autoTitle,
          description: newTaskDesc.trim(),
          mode: newTaskMode,
        })
      })
      if (res.ok) {
        const data = await res.json()
        setShowNewTask(false)
        setNewTaskTitle('')
        setNewTaskDesc('')
        setNewTaskMode('solo')
        // 自动发一条消息通知 Agent
        const notify = `📋 我刚创建了任务「${data.title}」${newTaskMode === 'team' ? '（团队模式）' : ''}，请帮我拆解步骤吧！`
        sendMessage(notify)
        // 刷新统计
        fetch('/api/tasks/stats').then(r => r.ok ? r.json() : null).then(d => d && setStats(d)).catch(() => {})
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || '创建任务失败')
      }
    } catch {
      alert('网络错误，请重试')
    } finally {
      setCreatingTask(false)
    }
  }

  // 创建日程
  const createSchedule = async () => {
    if (!scheduleForm.title.trim() || !scheduleForm.startDate || creatingSchedule) return
    setCreatingSchedule(true)
    try {
      const startAt = scheduleForm.allDay
        ? new Date(scheduleForm.startDate + 'T00:00:00').toISOString()
        : new Date(scheduleForm.startDate + 'T' + scheduleForm.startTime + ':00').toISOString()
      let remindAt = null
      if (scheduleForm.remindBefore !== 'none') {
        const mins = parseInt(scheduleForm.remindBefore)
        remindAt = new Date(new Date(startAt).getTime() - mins * 60 * 1000).toISOString()
      }
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: scheduleForm.title, emoji: scheduleForm.emoji, startAt,
          allDay: scheduleForm.allDay, remindAt, color: scheduleForm.color,
          description: scheduleForm.description || null,
        }),
      })
      if (res.ok) {
        setShowNewSchedule(false)
        setScheduleForm({ title: '', emoji: '📅', startDate: '', startTime: '09:00', allDay: false, remindBefore: '30', color: 'orange', description: '' })
        sendMessage(`📅 我刚创建了日程「${scheduleForm.title}」，请帮我记住哦！`)
      } else {
        alert('创建日程失败')
      }
    } catch {
      alert('网络错误，请重试')
    } finally {
      setCreatingSchedule(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white/60">加载中...</div>
      </div>
    )
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950 flex flex-col">

      {/* Header */}
      <header className="flex-shrink-0 border-b border-white/10 bg-slate-900/95 sticky top-0 z-30" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">

          {/* 左：返回 + Agent 头像 + 昵称 + 电话 */}
          <div className="flex items-center gap-2">
            <a href="/" className="text-white/40 hover:text-orange-400 transition-colors mr-1" title="返回首页">←</a>
            {agent ? (
              <>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {agent.name?.charAt(0) || '🦞'}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{agent.name}</div>
                  <div className="text-white/40 text-xs flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${agent.status === 'online' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                    {agent.status === 'online' ? '在线' : '忙碌中'}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleCallAgent}
                    disabled={calling}
                    title={calling ? '呼叫中...' : '三联呼 Agent'}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-all touch-manipulation
                      ${calling
                        ? 'text-orange-400 animate-pulse bg-orange-500/20'
                        : 'text-orange-400 active:bg-orange-500/30 hover:text-orange-300 hover:bg-orange-500/20'
                      } disabled:opacity-60`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {callFailed && (
                    <span className="text-[10px] text-rose-400 animate-pulse font-medium">Ta不在</span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-white/60 text-sm">未配对 Agent</div>
            )}
          </div>

          {/* 右：日程快捷 + 任务统计 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/calendar')}
              title="日程表"
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-orange-500/20 flex items-center justify-center text-white/60 hover:text-orange-400 transition-colors"
            >
              📅
            </button>
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                <span className="text-orange-400 text-xs font-bold">{stats.inProgress}</span>
                <span className="text-white/40 text-xs">待处理</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-emerald-400 text-xs font-bold">{stats.done}</span>
                <span className="text-white/40 text-xs">已完成</span>
              </div>
            </div>
          </div>

        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

          {messages.length === 0 && !loading && (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🦞</div>
              <h2 className="text-white text-lg font-medium mb-2">
                {agent ? `嘿，我是 ${agent.name}！` : '欢迎使用 TeamAgent'}
              </h2>
              <p className="text-white/50 text-sm max-w-xs mx-auto">
                {agent ? '有什么需要我帮忙的？' : '先去配对你的 Agent，然后就能开始聊天了'}
              </p>
              {!agent && (
                <button
                  onClick={() => router.push('/')}
                  className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-full text-sm font-medium"
                >
                  开始三步引导 →
                </button>
              )}
            </div>
          )}

          {messages.map((msg) => {
            // 解析附件
            let msgAttachments: ChatAttachment[] = []
            if (msg.metadata) {
              try {
                const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata
                msgAttachments = meta.attachments || []
              } catch { /* ignore */ }
            }
            const hasText = msg.content.trim().length > 0

            return (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl ${msg.pending ? 'px-4 py-3' : msgAttachments.length > 0 ? '' : 'px-4 py-2.5'} ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-orange-400 via-orange-500 to-rose-500 text-white rounded-br-md'
                    : 'bg-white/10 text-white/90 rounded-bl-md'
                } overflow-hidden`}>
                  {msg.pending ? (
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <>
                      {/* 图片附件 */}
                      {msgAttachments.filter(a => a.type?.startsWith('image/')).map((att, i) => (
                        <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                          <img src={att.url} alt={att.name} className="max-w-full max-h-60 object-cover" loading="lazy" />
                        </a>
                      ))}
                      {/* 非图片附件 */}
                      {msgAttachments.filter(a => !a.type?.startsWith('image/')).map((att, i) => (
                        <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                          className={`flex items-center gap-2 px-4 py-2 ${msg.role === 'user' ? 'text-white/90 hover:text-white' : 'text-blue-400 hover:text-blue-300'}`}>
                          <span>📎</span>
                          <span className="underline truncate">{att.name}</span>
                        </a>
                      ))}
                      {hasText && (
                        <p className={`text-sm whitespace-pre-wrap break-words ${msgAttachments.length > 0 ? 'px-4 pt-1' : ''}`}>{msg.content}</p>
                      )}
                      <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-white/40'} ${msgAttachments.length > 0 ? 'px-4 pb-2' : ''}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* 仅当没有 pending 消息时显示独立 typing 指示器（兼容 LLM fallback） */}
          {typing && !messages.some(m => m.pending) && (
            <div className="flex justify-start">
              <div className="bg-white/10 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* B13: 新建任务弹窗 */}
      {showNewTask && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => !creatingTask && setShowNewTask(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-md mx-4 mb-20 sm:mb-0 bg-slate-800 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-medium">📋 快速新建任务</h3>
              <button onClick={() => setShowNewTask(false)} className="text-white/40 hover:text-white text-lg">✕</button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* 标题（可留空，自动从描述提取） */}
              <div className="flex items-center gap-2">
                <input
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder="任务标题（可留空，自动生成）..."
                  className="flex-1 px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createTask() } }}
                />
                <VoiceMicButton variant="dark" size="sm"
                  onResult={(text) => setNewTaskTitle(prev => prev ? prev + ' ' + text : text)} append />
              </div>
              {/* 描述（必填） */}
              <div className="flex items-start gap-2">
                <textarea
                  value={newTaskDesc}
                  onChange={e => setNewTaskDesc(e.target.value)}
                  placeholder="任务描述（必填），AI 将自动拆解步骤..."
                  rows={3}
                  autoFocus
                  className="flex-1 px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                <VoiceMicButton variant="dark" size="sm" className="mt-2"
                  onResult={(text) => setNewTaskDesc(prev => prev ? prev + ' ' + text : text)} append />
              </div>
              {/* 模式选择 */}
              <div className="flex gap-2">
                <button
                  onClick={() => setNewTaskMode('solo')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    newTaskMode === 'solo'
                      ? 'bg-orange-500 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/15'
                  }`}
                >
                  🤖 Solo 模式
                </button>
                <button
                  onClick={() => setNewTaskMode('team')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    newTaskMode === 'team'
                      ? 'bg-orange-500 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/15'
                  }`}
                >
                  🤝 Team 模式
                </button>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
              <button
                onClick={() => setShowNewTask(false)}
                disabled={creatingTask}
                className="px-4 py-2 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={createTask}
                disabled={!newTaskDesc.trim() || creatingTask}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-white/20 disabled:text-white/40 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {creatingTask ? '⏳ 创建中...' : '✅ 创建任务'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建日程弹窗 */}
      {showNewSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => !creatingSchedule && setShowNewSchedule(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-lg mx-4 bg-slate-800 border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-orange-500/10">
              <h3 className="text-white font-medium flex items-center gap-2">
                <span className="text-lg">{scheduleForm.emoji}</span> 创建日程
              </h3>
              <button onClick={() => setShowNewSchedule(false)} className="text-white/40 hover:text-white text-lg">✕</button>
            </div>

            <div className="px-5 py-5 space-y-4">
              {/* 标题 + 语音 */}
              <div>
                <label className="text-xs text-white/50 mb-1 block">日程标题</label>
                <div className="flex items-center gap-2">
                  <input
                    value={scheduleForm.title}
                    onChange={e => setScheduleForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="例如：团队周会、产品评审..."
                    autoFocus
                    className="flex-1 px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createSchedule() } }}
                  />
                  <VoiceMicButton variant="dark" size="sm"
                    onResult={(text) => setScheduleForm(f => ({ ...f, title: f.title ? f.title + ' ' + text : text }))} append />
                </div>
              </div>

              {/* 日期 + 时间 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">日期</label>
                  <input
                    type="date"
                    value={scheduleForm.startDate}
                    onChange={e => setScheduleForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full bg-white/10 text-white text-sm rounded-xl px-3 py-2.5 border border-white/20 outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
                {!scheduleForm.allDay && (
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">时间</label>
                    <input
                      type="time"
                      value={scheduleForm.startTime}
                      onChange={e => setScheduleForm(f => ({ ...f, startTime: e.target.value }))}
                      className="w-full bg-white/10 text-white text-sm rounded-xl px-3 py-2.5 border border-white/20 outline-none focus:ring-2 focus:ring-orange-500/50"
                    />
                  </div>
                )}
              </div>

              {/* Emoji 选择 */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">图标</label>
                <div className="flex gap-1.5 flex-wrap">
                  {['📅', '🗓️', '🍽️', '🏃', '💼', '📞', '🎂', '📝', '💻', '🤝', '📚', '✈️', '🏥', '📦'].map(e => (
                    <button
                      key={e}
                      onClick={() => setScheduleForm(f => ({ ...f, emoji: e }))}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition ${scheduleForm.emoji === e ? 'bg-orange-500/20 ring-1 ring-orange-500 scale-110' : 'hover:bg-white/10'}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* 颜色 + 提醒 + 全天 */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">颜色</span>
                  {['orange', 'blue', 'emerald', 'rose', 'purple'].map(c => (
                    <button
                      key={c}
                      onClick={() => setScheduleForm(f => ({ ...f, color: c }))}
                      className={`w-5 h-5 rounded-full transition ${
                        c === 'orange' ? 'bg-orange-500' : c === 'blue' ? 'bg-blue-500' : c === 'emerald' ? 'bg-emerald-500' : c === 'rose' ? 'bg-rose-500' : 'bg-purple-500'
                      } ${scheduleForm.color === c ? 'ring-2 ring-offset-2 ring-offset-slate-800 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">提醒</span>
                  <select
                    value={scheduleForm.remindBefore}
                    onChange={e => setScheduleForm(f => ({ ...f, remindBefore: e.target.value }))}
                    className="bg-white/10 text-white text-xs rounded-lg px-2 py-1.5 border border-white/20 outline-none"
                  >
                    <option value="none">不提醒</option>
                    <option value="5">5分钟前</option>
                    <option value="15">15分钟前</option>
                    <option value="30">30分钟前</option>
                    <option value="60">1小时前</option>
                    <option value="1440">1天前</option>
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-white/50 ml-auto cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleForm.allDay}
                    onChange={e => setScheduleForm(f => ({ ...f, allDay: e.target.checked }))}
                    className="rounded border-slate-600"
                  />
                  全天
                </label>
              </div>

              {/* 备注 + 语音 */}
              <div>
                <label className="text-xs text-white/50 mb-1 block">备注</label>
                <div className="flex items-start gap-2">
                  <textarea
                    value={scheduleForm.description}
                    onChange={e => setScheduleForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="备注信息（可选）..."
                    rows={2}
                    className="flex-1 px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                  <VoiceMicButton variant="dark" size="sm" className="mt-2"
                    onResult={(text) => setScheduleForm(f => ({ ...f, description: f.description ? f.description + ' ' + text : text }))} append />
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="px-5 py-4 border-t border-white/10 flex justify-between items-center">
              <button
                onClick={() => router.push('/calendar')}
                className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
              >
                打开日程表 →
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewSchedule(false)}
                  disabled={creatingSchedule}
                  className="px-4 py-2 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={createSchedule}
                  disabled={!scheduleForm.title.trim() || !scheduleForm.startDate || creatingSchedule}
                  className="px-5 py-2 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 disabled:bg-white/20 disabled:from-transparent disabled:to-transparent disabled:text-white/40 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-orange-500/20"
                >
                  {creatingSchedule ? '⏳ 创建中...' : '✓ 创建日程'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <footer className="flex-shrink-0 border-t border-white/10 bg-slate-900/95 mb-16 md:mb-0">
        <div className="max-w-2xl mx-auto px-4 py-3">
          {/* 附件预览 */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {attachments.map((att, i) => (
                <div key={i} className="relative flex-shrink-0 group">
                  {att.type?.startsWith('image/') ? (
                    <img src={att.url} alt={att.name} className="h-16 w-16 object-cover rounded-lg border border-white/20" />
                  ) : (
                    <div className="h-16 w-16 bg-white/10 rounded-lg border border-white/20 flex items-center justify-center text-xs text-white/60 p-1 text-center truncate">
                      📎 {att.name}
                    </div>
                  )}
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-80 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
              {uploading && (
                <div className="h-16 w-16 bg-white/5 rounded-lg border border-dashed border-white/20 flex items-center justify-center flex-shrink-0">
                  <span className="animate-spin text-sm">⏳</span>
                </div>
              )}
            </div>
          )}
          {/* 隐藏文件input */}
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt,.md,.zip" multiple className="hidden" onChange={handleFileUpload} />
          {/* 快捷工具栏 */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setShowNewTask(true)}
              disabled={!agent}
              title="快速新建任务"
              className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-orange-500/20 disabled:opacity-30 text-white/60 hover:text-orange-400 rounded-full transition-colors text-xs"
            >
              📋 <span>新建</span>
            </button>
            <button
              onClick={() => {
                setShowNewSchedule(true)
                setScheduleForm(f => ({ ...f, startDate: new Date().toISOString().split('T')[0] }))
              }}
              disabled={!agent}
              title="快速创建日程"
              className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-purple-500/20 disabled:opacity-30 text-white/60 hover:text-purple-400 rounded-full transition-colors text-xs"
            >
              📅 <span>日程</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="上传图片/文件"
              className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-blue-500/20 disabled:opacity-30 text-white/60 hover:text-blue-400 rounded-full transition-colors text-xs"
            >
              📷 <span>上传</span>
            </button>
            <button
              onClick={() => {
                if (!agent || loading) return
                const growthPrompt = `请帮我分析一下你当前的能力状态，然后推荐 3-5 个对你最有价值的新技能。具体步骤：
1. 列出你当前已掌握的技能（已安装的 skills）
2. 搜索 ClawHub 上可用的新技能（clawhub search）
3. 根据我们的工作需求，推荐最有价值的技能，说明理由
4. 我确认后帮我自动安装（clawhub install）
5. 学习技能文档，总结新获得的能力

请开始吧！🌱`
                sendMessage(growthPrompt)
              }}
              disabled={!agent || loading}
              title="Agent 自主学习新技能"
              className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-emerald-500/20 disabled:opacity-30 text-white/60 hover:text-emerald-400 rounded-full transition-colors text-xs"
            >
              🌱 <span>成长</span>
            </button>
          </div>
          {/* 输入行：textarea（内含🎤）+ 发送 */}
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={agent ? `和${agent.name}说话...` : '先配对 Agent...'}
                disabled={!agent || loading}
                rows={1}
                className="w-full pl-4 pr-12 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder:text-white/40 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 disabled:opacity-50"
                style={{ minHeight: '48px', maxHeight: '120px', fontSize: '16px' }}
              />
              {/* 🎤 语音按钮在输入框内右侧 */}
              <div className="absolute right-2 bottom-1.5">
                <VoiceMicButton
                  variant="dark"
                  size="sm"
                  onResult={(text) => setInput(prev => prev ? prev + ' ' + text : text)}
                  append
                />
              </div>
            </div>
            <button
              onClick={() => sendMessage()}
              disabled={(!input.trim() && attachments.length === 0) || loading || !agent}
              className="w-12 h-12 bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/30 text-white rounded-full flex items-center justify-center transition-colors flex-shrink-0"
            >
              {loading ? <span className="animate-spin text-base">⏳</span> : <span className="text-lg">↑</span>}
            </button>
          </div>
        </div>
      </footer>

    </div>
  )
}

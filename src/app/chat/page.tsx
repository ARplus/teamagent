'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface Message {
  id: string
  content: string
  role: 'user' | 'agent'
  createdAt: string
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
  const latestMsgIdRef = useRef<string | null>(null)
  const isFirstLoad = useRef(true)

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
    }
  }, [session])

  // 滚动到底部 — 首次用 auto，后续用 smooth
  useEffect(() => {
    if (messages.length === 0) return
    const el = messagesEndRef.current
    if (!el) return
    if (isFirstLoad.current) {
      el.scrollIntoView()
      isFirstLoad.current = false
    } else {
      el.scrollIntoView({ behavior: 'smooth' })
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

  const sendMessage = async (text?: string) => {
    const content = text || input.trim()
    if (!content || loading) return

    setInput('')
    setLoading(true)

    const tempId = 'temp-' + Date.now()
    const userMsg: Message = {
      id: tempId,
      content,
      role: 'user',
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setTyping(true)

    let pendingMode = false
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })

      if (res.ok) {
        const data = await res.json()

        if (data.pending && data.agentMessageId) {
          pendingMode = true
          setMessages(prev => [
            ...prev.filter(m => m.id !== tempId),
            { ...userMsg, id: data.userMessageId },
            { id: data.agentMessageId, content: '...', role: 'agent' as const, createdAt: new Date().toISOString() },
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
                    m.id === data.agentMessageId ? { ...d.message, role: 'agent' as const } : m
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
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

          {/* 左：返回 */}
          <button onClick={() => router.push('/')} className="text-white/60 hover:text-white text-sm">
            ← 任务
          </button>

          {/* 中：Agent 信息 */}
          <div className="flex items-center gap-2">
            {agent ? (
              <>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center text-white text-sm font-bold">
                  {agent.name?.charAt(0) || '🦞'}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{agent.name}</div>
                  <div className="text-white/40 text-xs flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${agent.status === 'online' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                    {agent.status === 'online' ? '在线' : '忙碌中'}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-white/60 text-sm">未配对 Agent</div>
            )}
          </div>

          {/* 右：任务统计 */}
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1">
              <span className="text-orange-400 text-xs font-bold">{stats.inProgress}</span>
              <span className="text-white/40 text-xs">进行中</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-emerald-400 text-xs font-bold">{stats.done}</span>
              <span className="text-white/40 text-xs">已完成</span>
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
                  onClick={() => router.push('/build-agent')}
                  className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-full text-sm font-medium"
                >
                  配对 Agent
                </button>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-orange-500 text-white rounded-br-md'
                  : 'bg-white/10 text-white/90 rounded-bl-md'
              }`}>
                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-white/40'}`}>
                  {new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {typing && (
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

      {/* Input */}
      <footer className="flex-shrink-0 border-t border-white/10 bg-slate-900/95 mb-16 md:mb-0">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={agent ? `对 ${agent.name} 说点什么...` : '先配对 Agent...'}
                disabled={!agent || loading}
                rows={1}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder:text-white/40 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 disabled:opacity-50"
                style={{ minHeight: '48px', maxHeight: '120px', fontSize: '16px' }}
              />
            </div>
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading || !agent}
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

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { VoiceMicButton } from '@/components/VoiceMicButton'

interface Message {
  id: string
  content: string
  role: 'user' | 'agent'
  createdAt: string
  metadata?: {
    voice?: boolean
    action?: string
  }
}

interface AgentInfo {
  id: string
  name: string
  avatar?: string
  status: string
}

export default function ChatPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [typing, setTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isInitialLoad = useRef(true)
  const latestMsgIdRef = useRef<string | null>(null)

  // 认证检查
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?from=/chat')
    }
  }, [status, router])

  // 加载 Agent 信息和历史消息
  useEffect(() => {
    if (session?.user) {
      loadAgentAndHistory()
    }
  }, [session])

  // 滚动到底部 — 初次加载用 instant，后续用 smooth
  useEffect(() => {
    if (messages.length === 0) return
    const behavior = isInitialLoad.current ? 'instant' : 'smooth'
    messagesEndRef.current?.scrollIntoView({ behavior })
    if (isInitialLoad.current) isInitialLoad.current = false
  }, [messages, typing])

  // ── 后台轮询：每 4 秒检查有没有新消息 ──────────────────────────
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
      } catch (_) { /* 静默 */ }
    }, 4000)
    return () => clearInterval(interval)
  }, [session])

  const loadAgentAndHistory = async () => {
    try {
      const agentRes = await fetch('/api/agent/my')
      if (agentRes.ok) {
        const agentData = await agentRes.json()
        setAgent(agentData)
      }

      const historyRes = await fetch('/api/chat/history?limit=50')
      if (historyRes.ok) {
        const history = await historyRes.json()
        const msgs: Message[] = history.messages || []
        setMessages(msgs)
        if (msgs.length > 0) {
          latestMsgIdRef.current = msgs[msgs.length - 1].id
        }
      }
    } catch (e) {
      console.error('Failed to load agent/history:', e)
    }
  }

  const sendMessage = async (text?: string) => {
    const content = text || input.trim()
    if (!content || loading) return

    setInput('')
    setLoading(true)

    const userMsg: Message = {
      id: 'temp-' + Date.now(),
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
            ...prev.filter(m => m.id !== userMsg.id),
            { ...userMsg, id: data.userMessageId },
            { id: data.agentMessageId, content: '...', role: 'agent' as const, createdAt: new Date().toISOString() },
          ])
          latestMsgIdRef.current = data.agentMessageId

          // 轮询，不设上限 — 直到回复为止（后台轮询也会同步更新）
          let attempts = 0
          const poll = async () => {
            attempts++
            try {
              const pollRes = await fetch(`/api/chat/poll?msgId=${data.agentMessageId}`)
              if (pollRes.ok) {
                const pollData = await pollRes.json()
                if (pollData.ready) {
                  setMessages(prev => prev.map(m =>
                    m.id === data.agentMessageId ? { ...pollData.message, role: 'agent' as const } : m
                  ))
                  latestMsgIdRef.current = pollData.message.id
                  setLoading(false)
                  setTyping(false)
                  return
                }
              }
            } catch (_) { /* 继续重试 */ }
            // 前 30 次每 2 秒，之后每 5 秒（后台轮询兜底）
            const delay = attempts < 30 ? 2000 : 5000
            setTimeout(poll, delay)
          }
          poll()
        } else {
          setMessages(prev => [
            ...prev.filter(m => m.id !== userMsg.id),
            { ...userMsg, id: data.userMessageId },
            data.agentMessage,
          ])
          latestMsgIdRef.current = data.agentMessage?.id
        }
      } else {
        const err = await res.json()
        setMessages(prev => [
          ...prev,
          {
            id: 'error-' + Date.now(),
            content: `❌ ${err.error || '发送失败，请重试'}`,
            role: 'agent' as const,
            createdAt: new Date().toISOString(),
          },
        ])
      }
    } catch (e) {
      console.error('Send failed:', e)
      setMessages(prev => [
        ...prev,
        {
          id: 'error-' + Date.now(),
          content: '❌ 网络错误，请重试',
          role: 'agent' as const,
          createdAt: new Date().toISOString(),
        },
      ])
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

  const handleVoiceResult = (text: string) => {
    if (text.trim()) sendMessage(text)
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white/60">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-[100svh] bg-gradient-to-b from-slate-900 to-slate-950 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-white/10 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="text-white/60 hover:text-white text-sm"
          >
            ← 任务
          </button>

          <div className="flex items-center gap-2">
            {agent ? (
              <>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center text-white text-sm font-bold">
                  {agent.name?.charAt(0) || '🦞'}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{agent.name}</div>
                  <div className="text-white/40 text-xs flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${agent.status === 'online' ? 'bg-green-400' : 'bg-yellow-400'}`}></span>
                    {agent.status === 'online' ? '在线' : '忙碌中'}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-white/60 text-sm">未配对 Agent</div>
            )}
          </div>

          <div className="w-8" />
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🦞</div>
              <h2 className="text-white text-lg font-medium mb-2">
                {agent ? `嘿，我是 ${agent.name}！` : '欢迎使用 TeamAgent'}
              </h2>
              <p className="text-white/50 text-sm max-w-xs mx-auto">
                {agent
                  ? '有什么需要我帮忙的？说出来或打字都行！'
                  : '先去配对你的 Agent，然后就能开始聊天了'}
              </p>
              {!agent && (
                <button
                  onClick={() => router.push('/build-agent')}
                  className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-full text-sm font-medium hover:bg-orange-400"
                >
                  配对 Agent
                </button>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-orange-500 text-white rounded-br-md'
                    : 'bg-white/10 text-white/90 rounded-bl-md'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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
                  <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="flex-shrink-0 border-t border-white/10 bg-slate-900/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
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

            <VoiceMicButton
              onResult={handleVoiceResult}
              className="mb-1"
            />

            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading || !agent}
              className="w-12 h-12 bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/30 text-white rounded-full flex items-center justify-center transition-colors"
            >
              {loading ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span className="text-lg">↑</span>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
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

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  const loadAgentAndHistory = async () => {
    try {
      // 获取用户的主 Agent
      const agentRes = await fetch('/api/agent/my')
      if (agentRes.ok) {
        const agentData = await agentRes.json()
        setAgent(agentData)
      }
      
      // 获取聊天历史
      const historyRes = await fetch('/api/chat/history?limit=50')
      if (historyRes.ok) {
        const history = await historyRes.json()
        setMessages(history.messages || [])
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

    // 添加用户消息
    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      content,
      role: 'user',
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setTyping(true)

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })

      if (res.ok) {
        const data = await res.json()
        // 更新用户消息 ID + 添加 Agent 回复
        setMessages(prev => [
          ...prev.filter(m => m.id !== userMsg.id),
          { ...userMsg, id: data.userMessageId },
          data.agentMessage,
        ])
      } else {
        // 错误处理
        const err = await res.json()
        setMessages(prev => [
          ...prev,
          {
            id: 'error-' + Date.now(),
            content: `❌ ${err.error || '发送失败，请重试'}`,
            role: 'agent',
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
          role: 'agent',
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setLoading(false)
      setTyping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleVoiceResult = (text: string) => {
    if (text.trim()) {
      sendMessage(text)
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
    <div className="min-h-[100svh] bg-gradient-to-b from-slate-900 to-slate-950 flex flex-col pb-16">
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

          <div className="w-8" /> {/* Spacer */}
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
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder:text-white/40 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 disabled:opacity-50 text-sm"
                style={{ minHeight: '48px', maxHeight: '120px' }}
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
          
          <p className="text-center text-white/30 text-xs mt-2">
            个人AI团队 · 手机指挥Agent干活
          </p>
        </div>
      </footer>

      {/* 底部 Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-white/10 z-50">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-4">
          <button
            onClick={() => router.push('/')}
            className="flex flex-col items-center gap-0.5 text-white/40 hover:text-white/70 transition-colors px-4 py-1"
          >
            <span className="text-xl">📋</span>
            <span className="text-xs">任务</span>
          </button>
          <button
            className="flex flex-col items-center gap-0.5 text-orange-400 px-4 py-1"
          >
            <span className="text-xl">💬</span>
            <span className="text-xs font-medium">对话</span>
          </button>
          <button
            onClick={() => router.push('/settings')}
            className="flex flex-col items-center gap-0.5 text-white/40 hover:text-white/70 transition-colors px-4 py-1"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs">我</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

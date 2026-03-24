'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function ChatWidget() {
  const { status } = useSession()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)

    // 添加空的 assistant 消息用于流式填充
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/octopus/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }))
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: err.error || '出错了 🐙💤' }
          return copy
        })
        setStreaming(false)
        return
      }

      // 流式读取 SSE
      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
          try {
            const parsed = JSON.parse(line.slice(6))
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              accumulated += delta
              const acc = accumulated
              setMessages(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: acc }
                return copy
              })
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e: any) {
      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', content: '网络错误，请稍后再试 🐙' }
        return copy
      })
    } finally {
      setStreaming(false)
    }
  }, [input, messages, streaming])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 未登录不显示；/chat 和 /tasks 页面不显示（那两个页面自带对话入口）
  if (status !== 'authenticated') return null
  if (pathname === '/chat' || pathname === '/tasks') return null

  return (
    <>
      {/* 悬浮按钮 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-32 right-4 md:bottom-8 md:right-6 z-40 w-10 h-10 md:w-14 md:h-14 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-110 transition-all duration-300 flex items-center justify-center text-lg md:text-2xl"
          title="跟八爪聊天"
        >
          🐙
        </button>
      )}

      {/* 对话框 */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-3rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden">
          {/* 顶栏 */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-orange-500/10 to-rose-500/10 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <span className="text-xl">🐙</span>
              <div>
                <span className="text-white font-semibold text-sm">八爪 AI 助手</span>
                <span className="text-emerald-400 text-xs ml-2">在线</span>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700/50"
            >
              ✕
            </button>
          </div>

          {/* 消息区 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 text-sm mt-8">
                <div className="text-4xl mb-3">🐙</div>
                <p>你好！我是八爪，TeamAgent 的 AI 助手</p>
                <p className="text-xs mt-1 text-slate-600">有什么问题都可以问我~</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-orange-500 text-white rounded-br-md'
                    : 'bg-slate-800 text-slate-200 rounded-bl-md border border-slate-700/50'
                }`}>
                  {msg.content || (streaming && i === messages.length - 1 ? (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
                    </span>
                  ) : '')}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="px-3 py-3 border-t border-slate-700/50 bg-slate-900/80">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                rows={1}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500/50 max-h-24"
                style={{ minHeight: '40px' }}
                disabled={streaming}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white flex items-center justify-center hover:from-orange-400 hover:to-rose-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

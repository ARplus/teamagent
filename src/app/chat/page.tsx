'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

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

  // B13: 新建任务状态
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskMode, setNewTaskMode] = useState<'solo' | 'team'>('solo')
  const [creatingTask, setCreatingTask] = useState(false)

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

  // #3 fix: 监听 SSE chat:incoming → 立即刷新（Agent主动消息实时更新）
  useEffect(() => {
    const handler = async () => {
      try {
        const res = await fetch('/api/chat/history?limit=50')
        if (!res.ok) return
        const data = await res.json()
        const msgs: Message[] = data.messages || []
        setMessages(msgs)
        if (msgs.length > 0) latestMsgIdRef.current = msgs[msgs.length - 1].id
      } catch (_) {}
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
                    ? 'bg-orange-500 text-white rounded-br-md'
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
              <input
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder="任务标题（可留空，自动生成）..."
                className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createTask() } }}
              />
              {/* 描述（必填） */}
              <textarea
                value={newTaskDesc}
                onChange={e => setNewTaskDesc(e.target.value)}
                placeholder="任务描述（必填），AI 将自动拆解步骤..."
                rows={3}
                autoFocus
                className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
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
          <div className="flex items-end gap-2">
            {/* B13: 新建任务按钮 + 上传 + 成长 */}
            <div className="flex flex-col gap-1 flex-shrink-0">
              <button
                onClick={() => setShowNewTask(true)}
                disabled={!agent}
                title="快速新建任务"
                className="w-10 h-10 bg-white/10 hover:bg-white/15 disabled:opacity-30 text-white/70 hover:text-white rounded-full flex items-center justify-center transition-colors text-base"
              >
                📋
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="上传图片/文件"
                className="w-10 h-10 bg-white/10 hover:bg-blue-500/20 disabled:opacity-30 text-white/70 hover:text-blue-400 rounded-full flex items-center justify-center transition-colors text-base"
              >
                📷
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
                className="w-10 h-10 bg-white/10 hover:bg-emerald-500/20 disabled:opacity-30 text-white/70 hover:text-emerald-400 rounded-full flex items-center justify-center transition-colors text-base"
              >
                🌱
              </button>
            </div>
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

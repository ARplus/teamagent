'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { Navbar } from '@/components/Navbar'

interface Workspace {
  id: string
  name: string
  type?: string // normal | organization | plaza
  members: { user: { id: string; name: string; avatar: string | null } }[]
  _count: { tasks: number }
}

interface Channel {
  id: string
  name: string
  slug: string
  description: string | null
  isDefault: boolean
  _count: { messages: number }
}

interface Message {
  id: string
  content: string
  createdAt: string
  senderId: string
  senderName: string
  senderAvatar: string | null
  isFromAgent: boolean
  agentId: string | null
  agentName: string | null
  metadata: { attachments?: { type: string; name: string; url: string; size?: number }[] } | null
}

interface TeamMember {
  type: 'human'
  id: string
  name: string
  nickname: string | null
  avatar: string | null
  isSelf: boolean
  isOnline: boolean
  role: string
  agent: {
    id: string
    name: string
    status: string
    avatar: string | null
  } | null
}

function ChannelsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeChannelId = searchParams.get('c')
  const wsParam = searchParams.get('ws')

  // 工作区
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWsId, setActiveWsId] = useState<string | null>(wsParam)
  const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set())
  const [wsChannels, setWsChannels] = useState<Record<string, Channel[]>>({})
  const [loadingWs, setLoadingWs] = useState(true)

  // 消息 & 成员
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [showMobileChannels, setShowMobileChannels] = useState(!activeChannelId)
  const [showMobileMembers, setShowMobileMembers] = useState(false)

  // @mention
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStartPos, setMentionStartPos] = useState(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fetchAbortRef = useRef<AbortController | null>(null) // 取消过期的 fetch 请求

  // Auth redirect
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=%2Fchannels')
    }
  }, [status, router])

  // ===== 获取所有工作区 =====
  useEffect(() => {
    async function fetchWorkspaces() {
      try {
        const res = await fetch('/api/workspaces')
        if (res.ok) {
          const data: Workspace[] = await res.json()
          setWorkspaces(data)
          if (data.length > 0) {
            // 如果 URL 没有指定工作区，选第一个
            const initialWs = wsParam && data.find(w => w.id === wsParam) ? wsParam : data[0].id
            setActiveWsId(initialWs)
            // 默认展开当前工作区
            setExpandedWs(new Set([initialWs]))
          }
        }
      } catch (e) {
        console.error('获取工作区失败:', e)
      } finally {
        setLoadingWs(false)
      }
    }
    if (session) fetchWorkspaces()
  }, [session, wsParam])

  // ===== 获取频道列表（当工作区展开时） =====
  const fetchChannelsForWs = useCallback(async (workspaceId: string) => {
    if (wsChannels[workspaceId]) return // 已缓存
    try {
      const res = await fetch(`/api/channels?workspaceId=${workspaceId}`)
      if (res.ok) {
        const data = await res.json()
        setWsChannels(prev => ({ ...prev, [workspaceId]: data.channels || [] }))
      }
    } catch (e) {
      console.error('获取频道失败:', e)
    }
  }, [wsChannels])

  // 当工作区展开时自动获取频道
  useEffect(() => {
    expandedWs.forEach(wsId => {
      fetchChannelsForWs(wsId)
    })
  }, [expandedWs, fetchChannelsForWs])

  // 初始加载：自动加载当前工作区的频道并选中默认频道
  useEffect(() => {
    if (!activeWsId || activeChannelId) return
    async function loadInitial() {
      try {
        const res = await fetch(`/api/channels?workspaceId=${activeWsId}`)
        if (res.ok) {
          const data = await res.json()
          const channels = data.channels || []
          setWsChannels(prev => ({ ...prev, [activeWsId!]: channels }))
          if (channels.length > 0 && !activeChannelId) {
            router.replace(`/channels?ws=${activeWsId}&c=${channels[0].id}`, { scroll: false })
          }
        }
      } catch (e) {
        console.error('加载初始频道失败:', e)
      }
    }
    loadInitial()
  }, [activeWsId])

  // ===== 获取成员（按当前活跃频道所在的工作区） =====
  const fetchMembers = useCallback(async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/workspace/team?workspaceId=${workspaceId}`)
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
      }
    } catch (e) {
      console.error('获取成员失败:', e)
    }
  }, [])

  useEffect(() => {
    if (session && activeWsId) {
      fetchMembers(activeWsId)
      const timer = setInterval(() => fetchMembers(activeWsId), 30000)
      return () => clearInterval(timer)
    }
  }, [session, activeWsId, fetchMembers])

  // 心跳：每 60s 上报在线状态，让队友看到自己在线
  useEffect(() => {
    if (!session) return
    const beat = () => fetch('/api/user/heartbeat', { method: 'POST' }).catch(() => {})
    beat() // 立即上报一次
    const timer = setInterval(beat, 60000)
    return () => clearInterval(timer)
  }, [session])

  // ===== 消息 =====
  const fetchMessages = useCallback(async (channelId: string, cursor?: string | null) => {
    if (!channelId) return
    // 非分页请求：取消上一个未完成的 fetch，避免旧响应覆盖新数据
    let signal: AbortSignal | undefined
    if (!cursor) {
      if (fetchAbortRef.current) fetchAbortRef.current.abort()
      fetchAbortRef.current = new AbortController()
      signal = fetchAbortRef.current.signal
    }
    try {
      if (!cursor) setLoadingMessages(true)
      const url = `/api/channels/${channelId}/messages?limit=50${cursor ? `&cursor=${cursor}` : ''}`
      const res = await fetch(url, signal ? { signal } : {})
      if (res.ok) {
        const data = await res.json()
        if (cursor) {
          setMessages(prev => [...data.messages, ...prev])
        } else {
          setMessages(data.messages)
        }
        setHasMore(data.hasMore)
        setNextCursor(data.nextCursor)
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return // 主动取消，忽略
      console.error('获取消息失败:', e)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    if (activeChannelId) {
      fetchMessages(activeChannelId)
      setShowMobileChannels(false)
      setShowMobileMembers(false)
    }
  }, [activeChannelId, fetchMessages])

  // Auto-scroll — 初次加载和新消息到达时都滚到底
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    if (messages.length > 0) {
      // 初次加载（从0到有消息）或新消息到达（长度增加）→ 滚到底
      // 加载更旧消息（向上翻页）时不滚动：此时 messages 长度增加但 nextCursor 会变
      const isNewMessages = messages.length > prevMsgCountRef.current || prevMsgCountRef.current === 0
      if (isNewMessages) {
        messagesEndRef.current?.scrollIntoView({ behavior: prevMsgCountRef.current === 0 ? 'instant' : 'smooth' })
      }
    }
    prevMsgCountRef.current = messages.length
  }, [messages.length])

  // SSE — AbortController 已处理并发竞态，直接触发即可
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.channelId === activeChannelId) {
        fetchMessages(activeChannelId!)
      }
    }
    window.addEventListener('teamagent:channel-refresh', handler)
    return () => window.removeEventListener('teamagent:channel-refresh', handler)
  }, [activeChannelId, fetchMessages])

  // Polling
  useEffect(() => {
    if (!activeChannelId) return
    const timer = setInterval(() => fetchMessages(activeChannelId), 8000)
    return () => clearInterval(timer)
  }, [activeChannelId, fetchMessages])

  // ===== @mention =====
  const allMentionable = useCallback(() => {
    const list: { id: string; name: string; type: 'human' | 'agent'; status?: string }[] = []
    for (const m of members) {
      list.push({ id: m.id, name: m.name || '匿名', type: 'human' })
      if (m.agent) {
        list.push({ id: m.agent.id, name: m.agent.name, type: 'agent', status: m.agent.status })
      }
    }
    // 在线 Agent 排最前，然后在线人类，最后离线
    list.sort((a, b) => {
      const aOnline = a.status === 'online' || a.status === 'working' ? 1 : 0
      const bOnline = b.status === 'online' || b.status === 'working' ? 1 : 0
      if (aOnline !== bOnline) return bOnline - aOnline
      if (a.type !== b.type) return a.type === 'agent' ? -1 : 1
      return 0
    })
    return list
  }, [members])

  const mentionCandidates = mentionQuery !== null
    ? allMentionable().filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 15)
    : []

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    const cursorPos = e.target.selectionStart || 0
    const textBefore = value.substring(0, cursorPos)
    const atMatch = textBefore.match(/@([^@\s]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionStartPos(cursorPos - atMatch[1].length - 1)
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  const insertMention = (candidate: { name: string }) => {
    const before = input.substring(0, mentionStartPos)
    const after = input.substring(mentionStartPos + (mentionQuery?.length || 0) + 1)
    setInput(before + `@${candidate.name} ` + after)
    setMentionQuery(null)
    inputRef.current?.focus()
  }

  const sendMessage = async () => {
    if (!input.trim() || !activeChannelId || sending) return
    const content = input.trim()
    setInput('')
    setMentionQuery(null)
    setSending(true)

    const optimistic: Message = {
      id: 'temp-' + Date.now(),
      content,
      createdAt: new Date().toISOString(),
      senderId: session?.user?.email || '',
      senderName: (session?.user as any)?.name || '我',
      senderAvatar: null,
      isFromAgent: false,
      agentId: null,
      agentName: null,
      metadata: null,
    }
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      await fetch(`/api/channels/${activeChannelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      fetchMessages(activeChannelId)
    } catch (e) {
      console.error('发送失败:', e)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionCandidates.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionCandidates[mentionIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const loadMore = () => {
    if (hasMore && nextCursor && activeChannelId) fetchMessages(activeChannelId, nextCursor)
  }

  const renderContent = (content: string) => {
    const parts = content.split(/(@\S+)/g)
    return parts.map((part, i) =>
      part.startsWith('@') ? <span key={i} className="text-orange-500 font-medium">{part}</span> : <span key={i}>{part}</span>
    )
  }

  const statusConfig: Record<string, { color: string; label: string; dot: string }> = {
    online:  { color: 'text-emerald-500', label: '在线', dot: 'bg-emerald-500' },
    working: { color: 'text-blue-500', label: '工作中', dot: 'bg-blue-500' },
    waiting: { color: 'text-amber-500', label: '等待中', dot: 'bg-amber-400' },
    offline: { color: 'text-slate-400', label: '离线', dot: 'bg-slate-300' },
  }

  // 找当前选中的频道
  const allChannels = Object.values(wsChannels).flat()
  const activeChannel = allChannels.find(c => c.id === activeChannelId)

  // 工作区切换
  const toggleWs = (wsId: string) => {
    setExpandedWs(prev => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
  }

  const selectChannel = (wsId: string, channelId: string) => {
    setActiveWsId(wsId)
    router.replace(`/channels?ws=${wsId}&c=${channelId}`, { scroll: false })
    setShowMobileChannels(false)
  }

  if (status === 'loading' || loadingWs) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Navbar />
        <div className="flex items-center justify-center h-[80vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      </div>
    )
  }

  if (!session?.user) return null

  // 统计在线人数
  const onlineAgentCount = members.filter(m => m.agent && ['online', 'working'].includes(m.agent.status)).length
  const onlineHumanCount = members.filter(m => m.isOnline).length
  const onlineCount = onlineAgentCount + onlineHumanCount
  const agentCount = members.filter(m => m.agent).length

  return (
    <div className="min-h-screen bg-slate-900">
      <Navbar />

      <div className="max-w-7xl mx-auto px-2 sm:px-4 pt-2">
        <a href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-orange-500 transition-colors mb-2">
          <span>←</span><span>返回首页</span>
        </a>
      </div>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 pb-20 md:pb-4" style={{ height: 'calc(100dvh - 64px)' }}>
        <div className="flex h-full gap-3">

          {/* ===== 左侧：工作区 + 频道列表 ===== */}
          <div className={`${showMobileChannels ? 'block' : 'hidden'} md:block w-full md:w-56 flex-shrink-0`}>
            <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-lg shadow-black/20 h-full flex flex-col">
              <div className="p-4 border-b border-slate-700/50">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>💬</span> 频道
                </h2>
                <p className="text-xs text-slate-400 mt-1">{workspaces.length} 个工作区</p>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {/* 我的工作区 */}
                {workspaces.filter(ws => ws.type !== 'plaza').map(ws => {
                  const isExpanded = expandedWs.has(ws.id)
                  const channels = wsChannels[ws.id] || []
                  const isActive = ws.id === activeWsId

                  return (
                    <div key={ws.id}>
                      <button
                        onClick={() => toggleWs(ws.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 group
                          ${isActive
                            ? 'bg-orange-500/15 text-orange-400'
                            : 'text-slate-200 hover:bg-slate-700 hover:text-white'
                          }`}
                      >
                        <span className={`transition-transform duration-200 text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        <span className="flex-1 truncate">{ws.name}</span>
                        <span className="text-[10px] font-normal text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          {ws.members?.length || 0}人
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="ml-3 mt-0.5 space-y-0.5 pb-1">
                          {channels.length === 0 && (
                            <div className="px-3 py-2">
                              <div className="animate-pulse h-3 bg-slate-600 rounded w-16" />
                            </div>
                          )}
                          {channels.map(ch => (
                            <button
                              key={ch.id}
                              onClick={() => selectChannel(ws.id, ch.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-1.5
                                ${ch.id === activeChannelId
                                  ? 'bg-orange-500/15 text-orange-400 font-medium'
                                  : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                                }`}
                            >
                              <span className="text-slate-400 text-[10px]">#</span>
                              <span className="flex-1 truncate">{ch.name}</span>
                              {ch._count.messages > 0 && (
                                <span className="text-[10px] text-slate-300 tabular-nums">{ch._count.messages}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* ===== 广场 ===== */}
                {workspaces.filter(ws => ws.type === 'plaza').length > 0 && (
                  <div className="pt-2 mt-2 border-t border-slate-700/50">
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider px-3 mb-2">🌐 广场</p>
                    {workspaces.filter(ws => ws.type === 'plaza').map(ws => {
                      const isExpanded = expandedWs.has(ws.id)
                      const channels = wsChannels[ws.id] || []
                      const isActive = ws.id === activeWsId

                      return (
                        <div key={ws.id}>
                          <button
                            onClick={() => toggleWs(ws.id)}
                            className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 group
                              ${isActive
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                              }`}
                          >
                            <span className={`transition-transform duration-200 text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            <span className="flex-1 truncate">{ws.name}</span>
                          </button>

                          {isExpanded && (
                            <div className="ml-3 mt-0.5 space-y-0.5 pb-1">
                              {channels.length === 0 && (
                                <div className="px-3 py-2">
                                  <div className="animate-pulse h-3 bg-slate-600 rounded w-16" />
                                </div>
                              )}
                              {channels.map(ch => (
                                <button
                                  key={ch.id}
                                  onClick={() => selectChannel(ws.id, ch.id)}
                                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5
                                    ${ch.id === activeChannelId
                                      ? 'bg-emerald-100/80 text-emerald-700 font-medium'
                                      : 'text-slate-500 hover:bg-slate-700 hover:text-slate-200'
                                    }`}
                                >
                                  <span className="text-emerald-400 text-[10px]">#</span>
                                  <span className="flex-1 truncate">{ch.name}</span>
                                  {ch._count.messages > 0 && (
                                    <span className="text-[10px] text-slate-300 tabular-nums">{ch._count.messages}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ===== 中间消息区 ===== */}
          <div className={`${showMobileChannels || showMobileMembers ? 'hidden' : 'flex'} md:flex flex-col flex-1 bg-slate-800 rounded-2xl border border-slate-700 shadow-lg shadow-black/20 overflow-hidden`}>
            {/* 频道头部 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-800">
              <button onClick={() => setShowMobileChannels(true)} className="md:hidden text-slate-400 hover:text-slate-300">←</button>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-slate-100"># {activeChannel?.name || '选择频道'}</h3>
                {activeChannel?.description && (
                  <p className="text-xs text-slate-400 truncate">{activeChannel.description}</p>
                )}
              </div>
              <button onClick={() => setShowMobileMembers(true)} className="md:hidden text-slate-400 hover:text-slate-300 text-sm">
                👥 {members.length}
              </button>
            </div>

            {/* 消息列表 */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {hasMore && (
                <div className="text-center">
                  <button onClick={loadMore} className="text-xs text-orange-500 hover:text-orange-600 px-3 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                    ↑ 加载更早的消息
                  </button>
                </div>
              )}

              {loadingMessages && messages.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
                </div>
              )}

              {!loadingMessages && messages.length === 0 && activeChannelId && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <span className="text-4xl mb-3">👋</span>
                  <p className="text-sm">欢迎来到 #{activeChannel?.name || '频道'}！</p>
                  <p className="text-xs mt-1">发送第一条消息开始聊天吧</p>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3 group">
                  <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold ${
                    msg.isFromAgent
                      ? 'bg-gradient-to-br from-orange-500 to-rose-500'
                      : 'bg-gradient-to-br from-blue-500 to-purple-500'
                  }`}>
                    {msg.isFromAgent ? '🤖' : (msg.senderName?.[0] || '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-slate-100">
                        {msg.isFromAgent ? (msg.agentName || 'Agent') : msg.senderName}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        msg.isFromAgent ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {msg.isFromAgent ? 'Agent' : '人类'}
                      </span>
                      <span className="text-[10px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date(msg.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                      {renderContent(msg.content)}
                    </div>
                    {msg.metadata?.attachments && msg.metadata.attachments.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.metadata.attachments.map((att, i) => (
                          att.type?.startsWith('image') ? (
                            <img key={i} src={att.url} alt={att.name} className="max-w-xs rounded-lg border border-slate-700" />
                          ) : (
                            <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 rounded-lg text-xs text-slate-300 hover:bg-slate-600/50 transition-colors border border-slate-600">
                              📎 {att.name}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入框 */}
            {activeChannelId && (
              <div className="border-t border-slate-700/50 p-3 bg-slate-800 relative">
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-slate-800 rounded-xl border border-slate-700 shadow-lg max-h-48 overflow-y-auto z-20">
                    {mentionCandidates.map((c, i) => (
                      <button
                        key={c.id + c.type}
                        onClick={() => insertMention(c)}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors
                          ${i === mentionIndex ? 'bg-orange-500/20 text-orange-300' : 'text-slate-200 hover:bg-slate-700'}`}
                      >
                        <span className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${
                          c.type === 'agent' ? 'bg-gradient-to-br from-orange-500 to-rose-500' : 'bg-gradient-to-br from-blue-500 to-purple-500'
                        }`}>
                          {c.type === 'agent' ? '🤖' : c.name[0]}
                        </span>
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          c.type === 'agent' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {c.type === 'agent' ? 'Agent' : '人类'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={`在 #${activeChannel?.name || '频道'} 中发消息... 输入 @ 提及成员`}
                    rows={1}
                    className="flex-1 resize-none px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/50 transition-all"
                    style={{ maxHeight: '120px' }}
                    onInput={(e) => {
                      const t = e.target as HTMLTextAreaElement
                      t.style.height = 'auto'
                      t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                    }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || sending}
                    className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl text-sm font-medium hover:from-orange-600 hover:to-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-black/20 hover:shadow-md"
                  >
                    {sending ? '...' : '发送'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ===== 右侧成员面板（美化版） ===== */}
          <div className={`${showMobileMembers ? 'block' : 'hidden'} md:block w-full md:w-56 flex-shrink-0`}>
            <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-lg shadow-black/20 h-full flex flex-col">
              <div className="p-3 border-b border-slate-700/50">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-100">👥 成员</h2>
                  <button onClick={() => setShowMobileMembers(false)} className="md:hidden text-slate-400 hover:text-slate-300 text-xs">← 返回</button>
                </div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-500">{onlineCount} 在线</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500">{members.length} 人类</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-500">{agentCount} Agent</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {/* 在线区域（在线人类 + 在线 Agent） */}
                {(members.some(m => m.isOnline) || members.some(m => m.agent && ['online', 'working'].includes(m.agent.status))) && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider px-2 mb-1">🟢 在线</p>
                    {/* 在线人类 */}
                    {members.filter(m => m.isOnline).map(m => (
                      <div key={'online-' + m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-emerald-50/50 transition-colors">
                        <div className="relative flex-shrink-0">
                          {m.avatar ? (
                            <img src={m.avatar} alt="" className="w-8 h-8 rounded-full object-cover shadow-lg shadow-black/20" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-black/20">
                              {(m.name || '?')[0]}
                            </div>
                          )}
                          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-200 truncate">
                            {m.name || '匿名'}{m.isSelf && <span className="text-slate-400 font-normal"> (我)</span>}
                          </div>
                          <div className="text-[10px] text-emerald-500">在线</div>
                        </div>
                      </div>
                    ))}
                    {/* 在线 Agent */}
                    {members.filter(m => m.agent && ['online', 'working'].includes(m.agent.status)).map(m => (
                      <div key={m.agent!.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-emerald-50/50 transition-colors">
                        <div className="relative flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center text-white text-xs shadow-lg shadow-black/20">
                            🤖
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${statusConfig[m.agent!.status]?.dot}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-200 truncate">{m.agent!.name}</div>
                          <div className={`text-[10px] ${statusConfig[m.agent!.status]?.color}`}>
                            {statusConfig[m.agent!.status]?.label}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 离线人类成员 */}
                {members.filter(m => !m.isOnline).length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider px-2 mb-1">🧑 人类</p>
                    {members.filter(m => !m.isOnline).map(m => (
                      <div key={m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-700 transition-colors opacity-70">
                        <div className="relative flex-shrink-0">
                          {m.avatar ? (
                            <img src={m.avatar} alt="" className="w-8 h-8 rounded-full object-cover shadow-lg shadow-black/20" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-black/20">
                              {(m.name || '?')[0]}
                            </div>
                          )}
                          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-400 truncate">{m.name || '匿名'}</div>
                          <div className="text-[10px] text-slate-500">
                            {m.role === 'owner' ? '👑 创建者' : m.role === 'admin' ? '⭐ 管理员' : '成员'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 离线 Agent */}
                {members.some(m => m.agent && !['online', 'working'].includes(m.agent.status)) && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1">💤 离线 Agent</p>
                    {members.filter(m => m.agent && !['online', 'working'].includes(m.agent.status)).map(m => (
                      <div key={m.agent!.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-700 transition-colors opacity-60">
                        <div className="relative flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white text-xs shadow-lg shadow-black/20">
                            🤖
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-slate-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-500 truncate">{m.agent!.name}</div>
                          <div className="text-[10px] text-slate-400">离线</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {members.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">暂无成员</p>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900">
        <div className="flex items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      </div>
    }>
      <ChannelsContent />
    </Suspense>
  )
}

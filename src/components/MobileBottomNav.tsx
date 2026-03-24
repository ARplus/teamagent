'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

type TabId = 'tasks' | 'academy' | 'chat' | 'channels' | 'workspace'

export function MobileBottomNav() {
  const { status } = useSession()
  const pathname = usePathname() || ''
  const [taskCount, setTaskCount] = useState(0)

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    const load = () =>
      fetch('/api/tasks/stats')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && !cancelled) setTaskCount(d.inProgress || 0) })
        .catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [status])

  if (status !== 'authenticated') return null

  const authPages = ['/login', '/register', '/landing', '/build-agent']
  if (authPages.some((p) => pathname === p)) return null

  const isChatRoute = pathname.startsWith('/chat')
  const isTasksRoute = pathname.startsWith('/tasks')
  const isTeam = pathname.startsWith('/team') || pathname.startsWith('/workspace') || pathname.startsWith('/agents') || pathname.startsWith('/me')
  const isAcademy = pathname.startsWith('/academy')
  const isChannels = pathname.startsWith('/channels')

  const activeTab: TabId = isChannels ? 'channels' : isAcademy ? 'academy' : isTeam ? 'workspace' : isChatRoute ? 'chat' : isTasksRoute ? 'tasks' : 'tasks'

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-end justify-around px-1 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* 任务 */}
        <Link
          href="/tasks?t=tasks"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 relative ${activeTab === 'tasks' ? 'text-orange-400' : 'text-slate-500'}`}
        >
          <span className="text-lg leading-none">📋</span>
          <span className="text-[10px] font-medium">任务</span>
          {taskCount > 0 && (
            <span className="absolute -top-1 right-0 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-0.5 shadow-lg shadow-red-500/40">
              {taskCount > 99 ? '99+' : taskCount}
            </span>
          )}
        </Link>

        {/* 学院 */}
        <Link
          href="/academy"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 relative ${activeTab === 'academy' ? 'text-orange-400' : 'text-slate-500'}`}
        >
          <span className="text-lg leading-none">🦞</span>
          <span className="text-[10px] font-medium">学院</span>
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        </Link>

        {/* 对话 — 中心按钮 */}
        <Link
          href="/chat"
          className="flex flex-col items-center gap-0.5 -mt-2"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${activeTab === 'chat' ? 'bg-orange-500 shadow-orange-500/40' : 'bg-slate-700 shadow-slate-900/60'}`}>
            <span className="text-xl leading-none">💬</span>
          </div>
          <span className={`text-[10px] font-semibold ${activeTab === 'chat' ? 'text-orange-400' : 'text-slate-500'}`}>对话</span>
        </Link>

        {/* 广场 */}
        <Link
          href="/channels"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 ${activeTab === 'channels' ? 'text-orange-400' : 'text-slate-500'}`}
        >
          <span className="text-lg leading-none">📢</span>
          <span className="text-[10px] font-medium">广场</span>
        </Link>

        {/* 工作区 */}
        <Link
          href="/workspace"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 ${activeTab === 'workspace' ? 'text-orange-400' : 'text-slate-500'}`}
        >
          <span className="text-lg leading-none">🏠</span>
          <span className="text-[10px] font-medium">工作区</span>
        </Link>
      </div>
    </nav>
  )
}

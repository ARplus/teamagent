'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'

type TabId = 'chat' | 'tasks' | 'profile'

export function MobileBottomNav() {
  const { status } = useSession()
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const [taskCount, setTaskCount] = useState(0)

  // Fetch pending task count (lightweight, only when authenticated)
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
  const isRoot = pathname === '/'
  const isTeam = pathname.startsWith('/team') || pathname.startsWith('/workspace') || pathname.startsWith('/agents') || pathname.startsWith('/me')

  const t = searchParams.get('t')
  const rootTab: TabId = t === 'tasks' ? 'tasks' : t === 'profile' ? 'profile' : 'chat'

  const activeTab: TabId = isTeam ? 'profile' : isChatRoute ? 'chat' : isRoot ? rootTab : 'chat'

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-end justify-around px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          href="/?t=tasks"
          onClick={() => window.dispatchEvent(new CustomEvent('mobileTabChange', { detail: { tab: 'tasks' } }))}
          className={`flex flex-col items-center gap-0.5 px-4 py-1 relative ${activeTab === 'tasks' ? 'text-orange-400' : 'text-slate-500'}`}
        >
          <span className="text-xl leading-none">📋</span>
          <span className="text-xs font-medium">任务</span>
          {taskCount > 0 && (
            <span className="absolute -top-1 right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 shadow-lg shadow-red-500/40">
              {taskCount > 99 ? '99+' : taskCount}
            </span>
          )}
        </Link>

        <Link
          href="/"
          onClick={() => window.dispatchEvent(new CustomEvent('mobileTabChange', { detail: { tab: 'chat' } }))}
          className="flex flex-col items-center gap-1 -mt-4"
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg ${activeTab === 'chat' ? 'bg-orange-500 shadow-orange-500/40 scale-105' : 'bg-slate-700 shadow-slate-900/60'}`}>
            <span className="text-2xl leading-none">💬</span>
          </div>
          <span className={`text-xs font-semibold ${activeTab === 'chat' ? 'text-orange-400' : 'text-slate-500'}`}>对话</span>
        </Link>

        <Link
          href="/workspace"
          className={`flex flex-col items-center gap-0.5 px-4 py-1 ${activeTab === 'profile' ? 'text-orange-400' : 'text-slate-500'}`}
        >
          <span className="text-xl leading-none">🏠</span>
          <span className="text-xs font-medium">工作区</span>
        </Link>
      </div>
    </nav>
  )
}

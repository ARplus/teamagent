'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'

type TabId = 'chat' | 'tasks' | 'profile'

export function MobileBottomNav() {
  const { status } = useSession()
  const pathname = usePathname()

  if (status !== 'authenticated') return null
  const authPages = ['/login', '/register', '/landing', '/build-agent']
  if (authPages.some(p => pathname === p || pathname.startsWith(p + '?'))) return null

  const isTeam = pathname.startsWith('/team') || pathname.startsWith('/agents') || pathname.startsWith('/me')
  const isRoot = pathname === '/'
  const isTasksRoute = pathname.startsWith('/tasks')
  const isChatRoute = pathname.startsWith('/chat')

  const getRootTabFromLocation = (): TabId => {
    if (typeof window === 'undefined') return 'chat'
    const t = new URLSearchParams(window.location.search).get('t')
    return t === 'tasks' ? 'tasks' : t === 'profile' ? 'profile' : 'chat'
  }

  const [rootTab, setRootTab] = useState<TabId>(() => getRootTabFromLocation())

  useEffect(() => {
    setRootTab(getRootTabFromLocation())
  }, [pathname])

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: TabId }>).detail?.tab
      if (tab) setRootTab(tab)
    }
    const syncFromUrl = () => setRootTab(getRootTabFromLocation())
    window.addEventListener('mobileTabChange', handler)
    window.addEventListener('popstate', syncFromUrl)
    return () => {
      window.removeEventListener('mobileTabChange', handler)
      window.removeEventListener('popstate', syncFromUrl)
    }
  }, [])

  const activeTab: TabId = isTeam
    ? 'profile'
    : isTasksRoute
      ? 'tasks'
      : isChatRoute
        ? 'chat'
        : isRoot
          ? rootTab
          : 'chat'

  const handleRootTabClick = (tab: TabId) => {
    if (isRoot && tab !== 'profile') {
      setRootTab(tab)
      window.dispatchEvent(new CustomEvent('mobileTabChange', { detail: { tab } }))
      const url = tab === 'tasks' ? '/?t=tasks' : '/'
      window.history.pushState({}, '', url)
      return true
    }
    return false
  }

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-end justify-around px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">

        {/* 任务 */}
        <Link
          href="/?t=tasks"
          onClick={(e) => { if (handleRootTabClick('tasks')) e.preventDefault() }}
          className={`flex flex-col items-center gap-0.5 px-4 py-1 transition-colors ${
            activeTab === 'tasks' ? 'text-orange-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl leading-none">📋</span>
          <span className="text-xs font-medium">任务</span>
        </Link>

        {/* 对话 — 中间大按钮 */}
        <Link
          href="/"
          onClick={(e) => { if (handleRootTabClick('chat')) e.preventDefault() }}
          className="flex flex-col items-center gap-1 -mt-4"
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all ${
            activeTab === 'chat'
              ? 'bg-orange-500 shadow-orange-500/40 scale-105'
              : 'bg-slate-700 shadow-slate-900/60'
          }`}>
            <span className="text-2xl leading-none">💬</span>
          </div>
          <span className={`text-xs font-semibold ${activeTab === 'chat' ? 'text-orange-400' : 'text-slate-500'}`}>
            对话
          </span>
        </Link>

        {/* 我 */}
        <Link
          href="/team"
          className={`flex flex-col items-center gap-0.5 px-4 py-1 transition-colors ${
            activeTab === 'profile' ? 'text-orange-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl leading-none">👤</span>
          <span className="text-xs font-medium">我</span>
        </Link>

      </div>
    </nav>
  )
}

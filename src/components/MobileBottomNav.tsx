'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

type TabId = 'chat' | 'tasks' | 'profile'

const TABS: { id: TabId; icon: string; label: string; href: string; matchPaths: string[] }[] = [
  { id: 'chat',    icon: '💬', label: '对话',  href: '/',      matchPaths: ['/'] },
  { id: 'tasks',   icon: '📋', label: '任务',  href: '/?t=tasks', matchPaths: [] },
  { id: 'profile', icon: '👤', label: '我',    href: '/team',  matchPaths: ['/team', '/agents', '/me'] },
]

export function MobileBottomNav() {
  const { status } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  if (status !== 'authenticated') return null
  if (['/landing', '/login', '/register', '/build-agent'].includes(pathname)) return null

  // 当前激活的 tab
  const getActiveTab = (): TabId => {
    if (pathname === '/') {
      // 在主页时，通过 URL search param 判断
      if (typeof window !== 'undefined') {
        const t = new URLSearchParams(window.location.search).get('t')
        if (t === 'tasks') return 'tasks'
        if (t === 'profile') return 'profile'
      }
      return 'chat'
    }
    if (TABS.find(t => t.id === 'profile')?.matchPaths.some(p => pathname.startsWith(p))) return 'profile'
    return 'chat'
  }

  const activeTab = getActiveTab()

  const handleTabClick = (tab: TabId, href: string) => {
    if (tab === 'profile') {
      // "我" 始终跳到 /team 页面（有完整战队信息）
      router.push('/team')
      return
    }
    if (pathname === '/') {
      // 在主页：派发自定义事件让 page.tsx 切换 tab，不导航
      window.dispatchEvent(new CustomEvent('mobileTabChange', { detail: { tab } }))
      const url = tab === 'chat' ? '/' : `/?t=${tab}`
      window.history.pushState({}, '', url)
    } else {
      // 在其他页面：导航到 /（对话）或 /?t=tasks（任务）
      if (tab === 'chat') router.push('/')
      else if (tab === 'tasks') router.push('/?t=tasks')
    }
  }

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 flex border-t border-slate-700/60 bg-slate-900 safe-area-bottom">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab.id, tab.href)}
          className={`flex-1 py-3 flex flex-col items-center space-y-0.5 transition-colors ${
            activeTab === tab.id ? 'text-orange-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl leading-none">{tab.icon}</span>
          <span className="text-xs font-medium">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

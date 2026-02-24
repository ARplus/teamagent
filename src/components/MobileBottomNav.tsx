'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

type TabId = 'chat' | 'tasks' | 'profile'

export function MobileBottomNav() {
  const { status } = useSession()
  const pathname = usePathname()

  // 未登录、加载中、或在认证页 → 不显示
  if (status !== 'authenticated') return null
  const authPages = ['/login', '/register', '/landing', '/build-agent']
  if (authPages.some(p => pathname === p || pathname.startsWith(p + '?'))) return null

  const isTeam = pathname.startsWith('/team') || pathname.startsWith('/agents') || pathname.startsWith('/me')
  const isRoot = pathname === '/'

  // 读 URL search param 判断在根页面时的 tab
  const searchParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('t') : null
  const rootTab: TabId = searchParam === 'tasks' ? 'tasks' : searchParam === 'profile' ? 'profile' : 'chat'

  const activeTab: TabId = isTeam ? 'profile' : isRoot ? rootTab : 'chat'

  const tabs: { id: TabId; icon: string; label: string; href: string }[] = [
    { id: 'chat',    icon: '💬', label: '对话', href: '/' },
    { id: 'tasks',   icon: '📋', label: '任务', href: '/?t=tasks' },
    { id: 'profile', icon: '👤', label: '我',   href: '/team' },
  ]

  const handleClick = (tab: TabId) => {
    if (isRoot && tab !== 'profile') {
      // 在主页时通过 custom event 切 tab，避免页面跳转
      window.dispatchEvent(new CustomEvent('mobileTabChange', { detail: { tab } }))
      const url = tab === 'tasks' ? '/?t=tasks' : '/'
      window.history.pushState({}, '', url)
      return true // 阻止 Link 默认跳转
    }
    return false
  }

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 flex border-t border-slate-700/60 bg-slate-900">
      {tabs.map(tab => (
        <Link
          key={tab.id}
          href={tab.href}
          onClick={(e) => {
            const handled = handleClick(tab.id)
            if (handled) e.preventDefault()
          }}
          className={`flex-1 py-3 flex flex-col items-center space-y-0.5 transition-colors ${
            activeTab === tab.id ? 'text-orange-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl leading-none">{tab.icon}</span>
          <span className="text-xs font-medium">{tab.label}</span>
        </Link>
      ))}
    </nav>
  )
}

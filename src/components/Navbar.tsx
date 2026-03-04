'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { NotificationBell } from './NotificationBell'
import { PairingModal } from './PairingModal'

// Agent 状态配置
const agentStatusConfig: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  online: { label: '在线', color: 'text-green-700', bgColor: 'bg-green-50', icon: '🟢' },
  working: { label: '干活中', color: 'text-blue-700', bgColor: 'bg-blue-50', icon: '🔵' },
  waiting: { label: '等待中', color: 'text-yellow-700', bgColor: 'bg-yellow-50', icon: '🟡' },
  offline: { label: '离线', color: 'text-gray-500', bgColor: 'bg-gray-100', icon: '⚫' },
  error: { label: '出错了', color: 'text-red-700', bgColor: 'bg-red-50', icon: '🔴' },
  active: { label: '在线', color: 'text-green-700', bgColor: 'bg-green-50', icon: '🟢' }
}

export function Navbar() {
  const { data: session, status } = useSession()
  const [agentStatus, setAgentStatus] = useState<string>('offline')
  const [agentName, setAgentName] = useState<string>('Lobster')
  const [showPairingModal, setShowPairingModal] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (session) {
      fetchAgentStatus()
      const interval = setInterval(fetchAgentStatus, 10000)
      return () => clearInterval(interval)
    }
  }, [session])

  const fetchAgentStatus = async () => {
    try {
      const res = await fetch('/api/agent/status')
      if (res.ok) {
        const data = await res.json()
        setAgentStatus(data.status || 'online')
        setAgentName(data.name || 'Lobster')
      }
    } catch (e) {
      // ignore
    }
  }

  const statusInfo = agentStatusConfig[agentStatus] || agentStatusConfig.online

  return (
    <>
    <nav className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo + Desktop Nav */}
        <div className="flex items-center space-x-4 sm:space-x-8 min-w-0">
          <Link href={session ? "/" : "/landing"} className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            <span className="text-xl sm:text-2xl">🤝</span>
            <h1 className="text-base sm:text-xl font-bold text-gray-900">TeamAgent</h1>
            <span className="text-xs bg-gradient-to-r from-orange-500 to-red-500 text-white px-2 py-0.5 rounded-full hidden sm:inline">Beta</span>
          </Link>
          <Link href="/landing" target="_blank" className="hidden sm:inline-flex text-xs text-gray-400 hover:text-orange-500 border border-gray-200 hover:border-orange-300 px-2 py-1 rounded-lg transition-colors flex-shrink-0">
            🌐 官网
          </Link>

          {/* 桌面端导航链接 */}
          {session && (
            <div className="hidden md:flex items-center space-x-1 lg:space-x-2">
              <Link href="/" className="text-xs text-gray-600 hover:text-gray-900 whitespace-nowrap px-1.5 py-1 rounded-md hover:bg-gray-50 transition-colors">
                📋 首页
              </Link>
              <Link href="/tasks/new" className="text-xs text-gray-600 hover:text-gray-900 whitespace-nowrap px-1.5 py-1 rounded-md hover:bg-gray-50 transition-colors">
                ➕ 创建任务
              </Link>
              <Link href="/workspace" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-1.5 py-1 rounded-md hover:bg-orange-50 transition-colors">
                🏠 工作区
              </Link>
              <Link href="/guide/usage" className="text-xs text-gray-600 hover:text-blue-600 whitespace-nowrap px-1.5 py-1 rounded-md hover:bg-blue-50 transition-colors">
                📖 指南
              </Link>
              <Link href="/settings" className="text-xs text-gray-600 hover:text-gray-900 whitespace-nowrap px-1.5 py-1 rounded-md hover:bg-gray-50 transition-colors">
                ⚙️ 设置
              </Link>
              {session?.user?.email === 'aurora@arplus.top' && (
                <Link href="/admin" className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap px-1.5 py-1 rounded-md hover:bg-red-50 transition-colors">
                  🛡️ 管理
                </Link>
              )}
            </div>
          )}
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center space-x-2 sm:space-x-4">
          {/* Agent 状态 - 桌面端显示完整，移动端简化 */}
          {session && (
            <div className={`hidden sm:flex items-center space-x-2 ${statusInfo.bgColor} px-3 py-1.5 rounded-full`}>
              <span className="text-lg">🦞</span>
              <span className={`text-sm font-medium ${statusInfo.color}`}>
                {agentName} {statusInfo.label}
              </span>
              <span className="text-sm">{statusInfo.icon}</span>
            </div>
          )}
          {/* 移动端 Agent 状态简化版 */}
          {session && (
            <div className={`sm:hidden flex items-center space-x-1 ${statusInfo.bgColor} px-2 py-1 rounded-full`}>
              <span className="text-base">🦞</span>
              <span className="text-xs">{statusInfo.icon}</span>
            </div>
          )}

          {/* 配对 Agent 按钮 - 桌面端显示 */}
          {session && (
            <button
              onClick={() => setShowPairingModal(true)}
              className="hidden sm:flex items-center space-x-1.5 text-sm text-slate-600 hover:text-orange-600 border border-slate-200 hover:border-orange-300 px-3 py-1.5 rounded-xl transition-colors hover:bg-orange-50"
              title="配对新 Agent"
            >
              <span>⊕</span>
              <span>配对 Agent</span>
            </button>
          )}

          {/* 通知铃铛 */}
          {session && <NotificationBell />}

          {/* 用户信息 - 桌面端 */}
          {status === 'loading' ? (
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
          ) : session?.user ? (
            <div className="hidden sm:flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {session.user.name?.[0] || session.user.email?.[0] || 'U'}
                </div>
                <span className="text-sm font-medium text-gray-700 hidden lg:inline">
                  {session.user.name || session.user.email?.split('@')[0]}
                </span>
              </div>
              <button
                onClick={() => signOut()}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                退出
              </button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center space-x-2">
              <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">登录</Link>
              <Link href="/register" className="text-sm bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-lg hover:from-orange-600 hover:to-red-600">注册</Link>
            </div>
          )}

          {/* 移动端汉堡菜单 */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-gray-600 p-2 hover:bg-gray-100 rounded-lg"
            aria-label="菜单"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* 移动端展开菜单 */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-gray-100 space-y-1">
          {session ? (
            <>
              <Link href="/" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>📋</span><span>首页</span>
              </Link>
              <Link href="/landing" target="_blank" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>🌐</span><span>官网</span>
              </Link>
              <Link href="/workspace" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>🏠</span><span>我的工作区</span>
              </Link>
              <button
                onClick={() => { setShowPairingModal(true); setMobileMenuOpen(false) }}
                className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50 w-full text-left"
              >
                <span>⊕</span><span>配对 Agent</span>
              </button>
              <Link href="/guide/usage" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>📖</span><span>使用指南</span>
              </Link>
              <Link href="/settings" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>⚙️</span><span>设置</span>
              </Link>
              {session?.user?.email === 'aurora@arplus.top' && (
                <Link href="/admin" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50" onClick={() => setMobileMenuOpen(false)}>
                  <span>🛡️</span><span>系统管理</span>
                </Link>
              )}
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {session.user?.name?.[0] || session.user?.email?.[0] || 'U'}
                  </div>
                  <span className="text-sm text-gray-700">{session.user?.name || session.user?.email?.split('@')[0]}</span>
                </div>
                <button onClick={() => signOut()} className="text-sm text-red-500 hover:text-red-700">退出</button>
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="flex items-center px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>登录</Link>
              <Link href="/register" className="flex items-center px-3 py-2 rounded-lg text-sm bg-gradient-to-r from-orange-500 to-red-500 text-white mx-3" onClick={() => setMobileMenuOpen(false)}>注册</Link>
            </>
          )}
        </div>
      )}
    </nav>

    {/* 配对 Modal */}
    {showPairingModal && (
      <PairingModal onClose={() => setShowPairingModal(false)} />
    )}
    </>
  )
}

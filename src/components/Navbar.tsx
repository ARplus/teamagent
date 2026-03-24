'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { NotificationBell } from './NotificationBell'

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
        setAgentStatus(data.status || 'offline')
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
      <div className="w-full flex items-center justify-between">
        {/* Logo + Desktop Nav */}
        <div className="flex items-center space-x-4 sm:space-x-8 min-w-0">
          <Link href="/" className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            <span className="text-xl sm:text-2xl">🦞🤝</span>
            <h1 className="text-base sm:text-xl font-bold text-gray-900">TeamAgent</h1>
          </Link>


          {/* 桌面端导航链接 — 精简为核心入口 */}
          {session && (
            <div className="hidden md:flex items-center space-x-1 lg:space-x-2">
              <Link href="/" className="text-xs text-gray-600 hover:text-gray-900 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                🏠 首页
              </Link>
              <Link href="/tasks" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                📋 任务
              </Link>
              <Link href="/chat" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                💬 对话
              </Link>
              <Link href="/channels" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                📢 频道
              </Link>
              <Link href="/workspace" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                🏠 工作区
              </Link>
              <Link href="/templates" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                📦 模版库
              </Link>
              <Link href="/academy" className="relative text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                🦞 学院
                <span className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[7px] font-bold px-1.5 py-px rounded-full animate-pulse leading-tight">HOT</span>
              </Link>
              <Link href="/scheduled" className="text-xs text-gray-600 hover:text-orange-600 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
                🔄 定时任务
              </Link>
              <Link href="/calendar" className="text-xs text-gray-600 hover:text-gray-500 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                📅 日程
              </Link>
              <Link href="/settings" className="text-xs text-gray-600 hover:text-gray-500 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                ⚙️ 设置
              </Link>
              {session?.user?.email === 'aurora@arplus.top' && (
                <Link href="/admin" className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
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

          {/* 通知铃铛 */}
          {session && <NotificationBell />}

          {/* 设置按钮 */}
          {session && (
            <Link href="/settings" className="hidden sm:flex text-gray-400 hover:text-orange-500 transition-colors" title="设置">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </Link>
          )}

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
                <span>🏠</span><span>首页</span>
              </Link>
              <Link href="/tasks" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>📋</span><span>任务</span>
              </Link>
              <Link href="/channels" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>📢</span><span>频道</span>
              </Link>
              <Link href="/workspace" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>🏠</span><span>我的工作区</span>
              </Link>
              <Link href="/templates" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>📦</span><span>模版库</span>
              </Link>
              <Link href="/scheduled" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>🔄</span><span>定时任务</span>
              </Link>
              <Link href="/calendar" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                <span>📅</span><span>日程表</span>
              </Link>
              <Link href="/academy" className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50 relative" onClick={() => setMobileMenuOpen(false)}>
                <span>🦞</span><span>龙虾学院</span>
                <span className="ml-1.5 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[9px] font-bold px-1.5 py-px rounded-full animate-pulse">HOT</span>
              </Link>
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

    </>
  )
}

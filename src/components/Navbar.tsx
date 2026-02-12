'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import Link from 'next/link'

// Agent 状态配置
const agentStatusConfig: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  online: { label: '在线', color: 'text-green-700', bgColor: 'bg-green-50', icon: '🟢' },
  working: { label: '干活中', color: 'text-blue-700', bgColor: 'bg-blue-50', icon: '🔵' },
  waiting: { label: '等待中', color: 'text-yellow-700', bgColor: 'bg-yellow-50', icon: '🟡' },
  offline: { label: '离线', color: 'text-gray-500', bgColor: 'bg-gray-100', icon: '⚫' },
  error: { label: '出错了', color: 'text-red-700', bgColor: 'bg-red-50', icon: '🔴' },
  active: { label: '在线', color: 'text-green-700', bgColor: 'bg-green-50', icon: '🟢' } // 默认
}

export function Navbar() {
  const { data: session, status } = useSession()
  const [agentStatus, setAgentStatus] = useState<string>('offline')
  const [agentName, setAgentName] = useState<string>('Lobster')

  // 获取 Agent 状态
  useEffect(() => {
    if (session) {
      fetchAgentStatus()
      // 每 10 秒刷新一次状态
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
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <Link href="/" className="flex items-center space-x-3">
            <span className="text-2xl">🤝</span>
            <h1 className="text-xl font-bold text-gray-900">TeamAgent</h1>
            <span className="text-xs bg-gradient-to-r from-orange-500 to-red-500 text-white px-2 py-0.5 rounded-full">Beta</span>
          </Link>

          {/* 导航链接 */}
          {session && (
            <div className="flex items-center space-x-6">
              <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">
                📋 看板
              </Link>
              <Link href="/tasks/new" className="text-sm text-gray-600 hover:text-gray-900">
                ➕ 创建任务
              </Link>
              <Link href="/settings" className="text-sm text-gray-600 hover:text-gray-900">
                ⚙️ 设置
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {/* Agent 状态 - 真实状态！ */}
          {session && (
            <div className={`flex items-center space-x-2 ${statusInfo.bgColor} px-3 py-1.5 rounded-full`}>
              <span className="text-lg">🦞</span>
              <span className={`text-sm font-medium ${statusInfo.color}`}>
                {agentName} {statusInfo.label}
              </span>
              <span className="text-sm">{statusInfo.icon}</span>
            </div>
          )}

          {/* 用户信息 */}
          {status === 'loading' ? (
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
          ) : session?.user ? (
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {session.user.name?.[0] || session.user.email?.[0] || 'U'}
                </div>
                <span className="text-sm font-medium text-gray-700">
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
            <div className="flex items-center space-x-2">
              <Link
                href="/login"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="text-sm bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-lg hover:from-orange-600 hover:to-red-600"
              >
                注册
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

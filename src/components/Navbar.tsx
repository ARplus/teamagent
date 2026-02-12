'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'

export function Navbar() {
  const { data: session, status } = useSession()

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
          {/* Lobster 状态 */}
          <div className="flex items-center space-x-2 bg-green-50 px-3 py-1.5 rounded-full">
            <span className="text-lg">🦞</span>
            <span className="text-sm font-medium text-green-700">Lobster 在线</span>
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          </div>

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

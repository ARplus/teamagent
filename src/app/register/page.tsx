'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signOut, useSession } from 'next-auth/react'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const { status: sessionStatus } = useSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 读取 URL 参数（autoBuy 等）— 用 state 避免 SSR hydration 问题
  const [autoBuy, setAutoBuy] = useState<string | null>(null)
  useEffect(() => {
    const ab = new URLSearchParams(window.location.search).get('autoBuy')
    if (ab) setAutoBuy(ab)
  }, [])

  // 已登录用户直接跳转
  useEffect(() => {
    if (sessionStatus !== 'authenticated') return
    // 等 autoBuy 参数读取完（给 100ms）
    const timer = setTimeout(() => {
      const ab = new URLSearchParams(window.location.search).get('autoBuy')
      router.replace(ab ? `/pay?plan=${ab}` : '/')
    }, 100)
    return () => clearTimeout(timer)
  }, [sessionStatus, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    if (password.length < 6) {
      setError('密码至少需要6个字符')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password
        })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '注册失败')
        return
      }

      // 注册成功 → 自动登录
      const signInResult = await signIn('credentials', {
        email,
        password,
        redirect: false
      })

      if (signInResult?.ok) {
        // 注册成功 → 有 autoBuy 则跳支付，否则进首页
        router.push(autoBuy ? `/pay?plan=${autoBuy}` : '/')
      } else {
        router.push('/login?registered=true')
      }
    } catch (err) {
      setError('注册失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  // =================== 注册表单 ===================
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center space-x-3 mb-4">
            <span className="text-5xl">🦞</span>
            <span className="text-4xl">🤝</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">加入 TeamAgent</h1>
          <p className="text-gray-600 mt-2">创建账号，认领你的 AI Agent</p>
        </div>

        {/* 注册表单 */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                你的名字
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="怎么称呼你？"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="至少6个字符"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                确认密码
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="再输入一次"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-lg font-semibold hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  创建账号中...
                </span>
              ) : (
                '🚀 创建账号'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              已有账号？{' '}
              {sessionStatus === 'authenticated' ? (
                <button
                  onClick={async () => {
                    await signOut({ redirect: false })
                    router.push('/login')
                  }}
                  className="text-orange-600 hover:text-orange-700 font-semibold"
                >
                  切换账号登录
                </button>
              ) : (
                <Link href={autoBuy ? `/login?autoBuy=${autoBuy}` : '/login'} className="text-orange-600 hover:text-orange-700 font-semibold">
                  立即登录
                </Link>
              )}
            </p>
          </div>
        </div>

        {/* 底部 */}
        <p className="text-center text-gray-500 text-sm mt-8">
          🦞 + 🤖 = 无敌协作组合
        </p>
      </div>
    </div>
  )
}

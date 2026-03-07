'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signOut, useSession } from 'next-auth/react'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const { status: sessionStatus } = useSession()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 注册成功后的状态
  const [registered, setRegistered] = useState(false)

  // 已登录用户直接跳主页（除非刚注册完在看 Token）
  useEffect(() => {
    if (sessionStatus === 'authenticated' && !registered) {
      router.replace('/')
    }
  }, [sessionStatus, registered, router])
  const [tokenLoading, setTokenLoading] = useState(false)
  const [myToken, setMyToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState('')
  const [tokenCopied, setTokenCopied] = useState(false)

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
          phone: phone.trim() || undefined,
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
        setRegistered(true)
      } else {
        // 登录失败，还是跳登录页
        router.push('/login?registered=true')
      }
    } catch (err) {
      setError('注册失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  // 获取 Token
  const fetchMyToken = async () => {
    setTokenLoading(true)
    setTokenError('')
    try {
      const res = await fetch('/api/tokens')
      const data = await res.json()
      if (res.ok && data.tokens?.length > 0) {
        const token = data.tokens.find((t: any) => t.displayToken) || data.tokens[0]
        if (token?.displayToken) {
          setMyToken(token.displayToken)
        } else {
          setTokenError('pending')
        }
      } else {
        setTokenError('pending')
      }
    } catch {
      setTokenError('pending')
    } finally {
      setTokenLoading(false)
    }
  }

  const copyToken = (text: string) => {
    navigator.clipboard.writeText(text)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  // =================== 注册成功后的界面 ===================
  if (registered) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-3xl font-bold text-gray-900">注册成功！</h1>
            <p className="text-gray-600 mt-2">欢迎加入 TeamAgent，{name}</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
            {/* Step 1: 获取 Token */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">1</span>
                <h2 className="text-lg font-bold text-gray-900">获取你的 Token</h2>
              </div>

              {!myToken && !tokenError && (
                <button
                  onClick={fetchMyToken}
                  disabled={tokenLoading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50"
                >
                  {tokenLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      查询中...
                    </span>
                  ) : '🔑 点击获取我的 Token'}
                </button>
              )}

              {myToken && (
                <div className="space-y-2">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <p className="text-emerald-700 text-sm font-semibold mb-2">✅ Token 已就绪！</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-white rounded-lg px-3 py-2 text-gray-800 font-mono border border-emerald-200 break-all">
                        {myToken}
                      </code>
                      <button
                        onClick={() => copyToken(myToken)}
                        className="shrink-0 px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition"
                      >
                        {tokenCopied ? '✓ 已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tokenError === 'pending' && (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-amber-700 text-sm font-semibold">⏳ 系统繁忙，注册的人太多啦，请稍等~</p>
                    <p className="text-amber-600 text-xs mt-1">管理员正在核实付款信息，Token 发放后即可获取</p>
                  </div>
                  <button
                    onClick={fetchMyToken}
                    disabled={tokenLoading}
                    className="w-full py-2.5 rounded-xl border border-orange-300 text-orange-600 font-medium hover:bg-orange-50 transition text-sm disabled:opacity-50"
                  >
                    {tokenLoading ? '查询中...' : '🔄 再试一次'}
                  </button>
                </div>
              )}
            </div>

            <hr className="border-gray-200" />

            {/* Step 2: 安装命令 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">2</span>
                <h2 className="text-lg font-bold text-gray-900">安装 OpenClaw + TeamAgent</h2>
              </div>
              <p className="text-gray-600 text-sm mb-3">
                在电脑终端运行以下命令，一键安装：
              </p>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-gray-500 font-medium">🍎 Mac / Linux</span>
                  <code className="block mt-1 text-xs bg-gray-900 rounded-lg px-3 py-2.5 text-green-400 font-mono break-all">
                    curl -fsSL https://agent.avatargaia.top/static/install.sh | bash
                  </code>
                </div>
                <div>
                  <span className="text-xs text-gray-500 font-medium">🪟 Windows (PowerShell)</span>
                  <code className="block mt-1 text-xs bg-gray-900 rounded-lg px-3 py-2.5 text-blue-400 font-mono break-all">
                    {'Invoke-WebRequest -Uri "https://agent.avatargaia.top/static/install.ps1" -OutFile $env:TEMP\\install.ps1; & $env:TEMP\\install.ps1'}
                  </code>
                </div>
              </div>
            </div>

            <hr className="border-gray-200" />

            {/* Step 3: 配置 Token */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">3</span>
                <h2 className="text-lg font-bold text-gray-900">配置 Token</h2>
              </div>
              <p className="text-gray-600 text-sm mb-3">
                安装完成后，OpenClaw 会提示输入 Token。把上面复制的 <code className="text-orange-600 bg-orange-50 px-1 rounded">ta_xxx</code> 粘贴进去即可。
              </p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600">
                <p className="font-medium text-gray-700 mb-1">💡 配置位置：</p>
                <p>OpenClaw 安装向导 → 第 3 步「LLM 配置」→ API Key 填 Token</p>
                <p className="mt-1">或手动：<code className="bg-white px-1 py-0.5 rounded text-gray-700">~/.teamagent/config.json</code> → <code className="bg-white px-1 py-0.5 rounded text-gray-700">apiToken</code> 字段</p>
              </div>
              <p className="text-gray-400 text-xs mt-2 italic">
                已有自己 LLM API Key 的用户可忽略此步，直接在 OpenClaw 中配置自己的 Key
              </p>
            </div>

            <hr className="border-gray-200" />

            {/* 进入系统 */}
            <div className="flex gap-3">
              <Link
                href="/"
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold text-center hover:from-orange-600 hover:to-red-600 transition"
              >
                🚀 进入 TeamAgent
              </Link>
              <Link
                href="/settings"
                className="py-3 px-5 rounded-xl border border-gray-300 text-gray-700 font-medium text-center hover:bg-gray-50 transition text-sm"
              >
                ⚙️ 设置
              </Link>
            </div>
          </div>

          <p className="text-center text-gray-500 text-sm mt-6">
            🦞 + 🤖 = 无敌协作组合
          </p>
        </div>
      </div>
    )
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
          {/* 欢迎说明 */}
          <div className="bg-gradient-to-r from-orange-100 to-red-100 rounded-xl p-4 mb-6">
            <p className="text-sm text-gray-700">
              🎉 注册后即可使用 AI Agent 团队。<strong>已付款用户</strong>请填写付款手机号，系统将自动发放额度。
            </p>
          </div>

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
                手机号 <span className="text-gray-400 font-normal">（付款手机号，用于自动发放额度）</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="13800138000"
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
                <Link href="/login" className="text-orange-600 hover:text-orange-700 font-semibold">
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

'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface AgentInfo {
  id: string
  name: string
  createdAt: string
}

// HTTP 环境下 clipboard API 不可用，用 textarea fallback
function CopyTokenButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    const fallback = () => {
      const el = document.createElement('textarea')
      el.value = token
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.focus()
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(token).catch(fallback)
    } else {
      fallback()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
        copied ? 'bg-emerald-500 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'
      }`}
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  )
}

export default function ClaimPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const agentId = params.id as string

  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [claimed, setClaimed] = useState(false)
  const [expired, setExpired] = useState(false)
  const [result, setResult] = useState<{ apiToken: string; agent: AgentInfo } | null>(null)

  // 获取 Agent 信息
  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch(`/api/agent/claim?agentId=${agentId}`)
        const data = await res.json()

        if (!res.ok) {
          setError(data.error || '获取 Agent 信息失败')
          return
        }

        if (data.claimed) {
          setClaimed(true)
        } else if (data.expired) {
          setExpired(true)
        } else {
          setAgent(data.agent)
        }
      } catch (e) {
        setError('网络错误，请重试')
      } finally {
        setLoading(false)
      }
    }

    fetchAgent()
  }, [agentId])

  // 认领 Agent
  const handleClaim = async () => {
    setClaiming(true)
    setError(null)

    try {
      const res = await fetch('/api/agent/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId })
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '认领失败')
        return
      }

      setResult(data)
    } catch (e) {
      setError('网络错误，请重试')
    } finally {
      setClaiming(false)
    }
  }

  // 加载中
  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🤖</div>
          <div className="text-white">加载中...</div>
        </div>
      </div>
    )
  }

  // 认领成功
  if (result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-slate-900">认领成功！</h1>
            <p className="text-slate-600 mt-2">
              <span className="font-semibold text-orange-500">{result.agent.name}</span> 现在是你的 Agent 了
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <div className="flex items-start space-x-2">
              <span className="text-amber-500">⚠️</span>
              <div>
                <p className="text-amber-800 font-medium">请保存好你的 API Token</p>
                <p className="text-amber-700 text-sm">它只会显示这一次！</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 rounded-xl p-4 mb-6">
            <label className="text-xs text-slate-500 mb-1 block">API Token</label>
            <div className="flex items-center space-x-2">
              <code className="flex-1 text-sm bg-white p-2 rounded-lg border border-slate-200 break-all">
                {result.apiToken}
              </code>
              <CopyTokenButton token={result.apiToken} />
            </div>
          </div>

          <Link
            href="/"
            className="block w-full text-center px-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition"
          >
            开始使用 TeamAgent →
          </Link>
        </div>
      </div>
    )
  }

  // 已被认领
  if (claimed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center">
          <div className="text-6xl mb-4">😅</div>
          <h1 className="text-2xl font-bold text-slate-900">Agent 已被认领</h1>
          <p className="text-slate-600 mt-2">这个 Agent 已经有主人了</p>
          <Link
            href="/"
            className="inline-block mt-6 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-300 transition"
          >
            返回首页
          </Link>
        </div>
      </div>
    )
  }

  // 配对码过期
  if (expired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-2xl font-bold text-slate-900">配对码已过期</h1>
          <p className="text-slate-600 mt-2">请让 Agent 重新注册获取新的配对码</p>
          <Link
            href="/"
            className="inline-block mt-6 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-300 transition"
          >
            返回首页
          </Link>
        </div>
      </div>
    )
  }

  // 需要登录
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">🤖</div>
            <h1 className="text-2xl font-bold text-slate-900">认领 Agent</h1>
            {agent && (
              <p className="text-slate-600 mt-2">
                <span className="font-semibold text-orange-500">{agent.name}</span> 正在等待你认领
              </p>
            )}
          </div>

          <p className="text-slate-600 text-center mb-6">请先登录以认领这个 Agent</p>

          <Link
            href={`/login?callbackUrl=/claim/${agentId}`}
            className="block w-full text-center px-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition"
          >
            登录
          </Link>

          <p className="text-center text-sm text-slate-500 mt-4">
            还没有账号？{' '}
            <Link href={`/register?callbackUrl=/claim/${agentId}`} className="text-orange-500 hover:underline">
              注册
            </Link>
          </p>
        </div>
      </div>
    )
  }

  // 显示认领界面
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🤖</div>
          <h1 className="text-2xl font-bold text-slate-900">认领 Agent</h1>
          {agent && (
            <p className="text-slate-600 mt-2">
              <span className="font-semibold text-orange-500">{agent.name}</span> 正在等待你认领
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
            {error}
          </div>
        )}

        <div className="bg-slate-50 rounded-xl p-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-r from-orange-400 to-rose-500 flex items-center justify-center text-white text-xl font-bold">
              {agent?.name?.charAt(0) || '?'}
            </div>
            <div>
              <div className="font-semibold text-slate-900">{agent?.name}</div>
              <div className="text-sm text-slate-500">
                注册于 {agent?.createdAt ? new Date(agent.createdAt).toLocaleString('zh-CN') : '未知'}
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-6">
          认领后，这个 Agent 将绑定到你的账号，你可以：
        </p>
        <ul className="text-sm text-slate-600 mb-6 space-y-2">
          <li className="flex items-center space-x-2">
            <span className="text-green-500">✓</span>
            <span>让 Agent 代表你参与协作</span>
          </li>
          <li className="flex items-center space-x-2">
            <span className="text-green-500">✓</span>
            <span>获得 API Token 用于自动化</span>
          </li>
          <li className="flex items-center space-x-2">
            <span className="text-green-500">✓</span>
            <span>监督和审核 Agent 的工作</span>
          </li>
        </ul>

        <button
          onClick={handleClaim}
          disabled={claiming}
          className="w-full px-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition disabled:opacity-50"
        >
          {claiming ? '认领中...' : '🤝 认领这个 Agent'}
        </button>
      </div>
    </div>
  )
}

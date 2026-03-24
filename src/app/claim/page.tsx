'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ClaimCodePage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedCode = code.trim()
  const isPairingCode = /^[a-zA-Z0-9]{4,6}$/.test(trimmedCode)  // 4-6位字母数字配对码
  const isAgentId = /^[a-z0-9]{20,}$/i.test(trimmedCode)        // 长ID
  const isValidInput = isPairingCode || isAgentId

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) {
      setError('请输入配对码或 Agent ID')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 短码(4-6位) → 配对码；长码(20+) → Agent ID
      const query = trimmed.length <= 6
        ? `code=${trimmed}`
        : `agentId=${trimmed}`
      const res = await fetch(`/api/agent/claim?${query}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '配对码无效')
        return
      }

      if (data.claimed) {
        setError('Agent 已被认领')
        return
      }

      if (data.expired) {
        setError('配对码已过期')
        return
      }

      // 跳转到认领页面
      router.push(`/claim/${data.agent.id}`)
    } catch (e) {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🔗</div>
          <h1 className="text-2xl font-bold text-slate-900">输入配对码</h1>
          <p className="text-slate-600 mt-2">输入 Agent 提供的配对码或 Agent ID</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              placeholder="配对码 或 Agent ID"
              className={`w-full text-center font-mono px-4 py-6 border-2 border-slate-200 rounded-xl focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 outline-none ${
                code.length <= 6 ? 'text-4xl tracking-[0.5em]' : 'text-lg tracking-normal'
              }`}
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || !isValidInput}
            className="w-full px-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-rose-600 transition disabled:opacity-50"
          >
            {loading ? '验证中...' : '验证配对码'}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link href="/" className="text-slate-500 hover:text-slate-700 text-sm">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface AgentPreview {
  agentId: string
  agentName: string
  agentStatus: string
  createdAt: string
}

interface PairingModalProps {
  onClose: () => void
}

export function PairingModal({ onClose }: PairingModalProps) {
  const router = useRouter()
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AgentPreview | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    // 自动聚焦第一个格
    inputRefs.current[0]?.focus()
  }, [])

  const code = digits.join('')

  // 当6位都填完，自动查找
  useEffect(() => {
    if (code.length === 6 && !preview) {
      handleFind()
    }
  }, [code])

  const handleDigitChange = (index: number, value: string) => {
    // 只接受数字
    const cleaned = value.replace(/\D/g, '')
    if (!cleaned && value) return // 非数字，不处理

    const newDigits = [...digits]

    if (cleaned.length > 1) {
      // 粘贴了多个字符，分散填入
      const chars = cleaned.slice(0, 6).split('')
      chars.forEach((c, i) => {
        if (index + i < 6) newDigits[index + i] = c
      })
      setDigits(newDigits)
      setPreview(null)
      setError(null)
      const nextIndex = Math.min(index + chars.length, 5)
      inputRefs.current[nextIndex]?.focus()
      return
    }

    newDigits[index] = cleaned
    setDigits(newDigits)
    setPreview(null)
    setError(null)

    // 自动跳到下一格
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        const newDigits = [...digits]
        newDigits[index - 1] = ''
        setDigits(newDigits)
        setPreview(null)
        inputRefs.current[index - 1]?.focus()
      } else {
        const newDigits = [...digits]
        newDigits[index] = ''
        setDigits(newDigits)
        setPreview(null)
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
    if (e.key === 'Enter' && code.length === 6) {
      handleFind()
    }
  }

  const handleFind = async () => {
    if (code.length !== 6) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/agent/find-by-code?code=${code}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '配对码无效')
        setLoading(false)
        return
      }

      setPreview(data)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    if (preview) {
      onClose()
      router.push(`/claim/${preview.agentId}`)
    }
  }

  const handleClear = () => {
    setDigits(Array(6).fill(''))
    setPreview(null)
    setError(null)
    inputRefs.current[0]?.focus()
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-rose-500 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg shadow-orange-500/30">
            🤖
          </div>
          <h2 className="text-xl font-bold text-slate-900">配对你的 Agent</h2>
          <p className="text-sm text-slate-500 mt-1">输入 Agent 提供的6位配对码</p>
        </div>

        {/* 6位数字输入 */}
        <div className="flex justify-center gap-2 mb-6">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={digit}
              onChange={e => handleDigitChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onFocus={e => e.target.select()}
              className={`w-11 h-14 text-center text-xl font-bold rounded-xl border-2 focus:outline-none transition-all ${
                error
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : preview
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                  : digit
                  ? 'border-orange-400 bg-orange-50 text-orange-700'
                  : 'border-slate-200 bg-slate-50 text-slate-800 focus:border-orange-400 focus:bg-orange-50/50'
              }`}
            />
          ))}
        </div>

        {/* 加载中 */}
        {loading && (
          <div className="text-center py-3">
            <div className="inline-flex items-center space-x-2 text-orange-500 text-sm">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span>查找中...</span>
            </div>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-center">
            <p className="text-red-600 text-sm">❌ {error}</p>
            <button
              onClick={handleClear}
              className="text-xs text-red-500 hover:text-red-700 mt-1 underline"
            >
              重新输入
            </button>
          </div>
        )}

        {/* Agent 预览 */}
        {preview && !loading && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-4 mb-5">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-lg font-bold shadow-md shadow-orange-500/20">
                {preview.agentName.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-slate-900">{preview.agentName}</div>
                <div className="flex items-center space-x-1 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs text-slate-500">找到了！准备认领</span>
                </div>
              </div>
              <div className="ml-auto text-2xl">✅</div>
            </div>
          </div>
        )}

        {/* 按钮 */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 text-slate-600 hover:bg-slate-100 rounded-xl font-medium text-sm transition-colors"
          >
            取消
          </button>
          {preview ? (
            <button
              onClick={handleConfirm}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-semibold text-sm hover:from-orange-400 hover:to-rose-400 shadow-lg shadow-orange-500/25 transition-all"
            >
              🤝 确认配对
            </button>
          ) : (
            <button
              onClick={handleFind}
              disabled={code.length !== 6 || loading}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-semibold text-sm hover:from-orange-400 hover:to-rose-400 shadow-lg shadow-orange-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              查找 Agent
            </button>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          配对码由你的 Agent 生成，有效期24小时
        </p>
      </div>
    </div>
  )
}

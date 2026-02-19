'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'

interface InviteInfo {
  valid: boolean
  inviter: { name: string; avatar: string | null }
  workspace: { id: string; name: string }
  task: { id: string; title: string; description: string; status: string } | null
}

export default function JoinPage() {
  const { token } = useParams() as { token: string }
  const { data: session, status } = useSession()
  const router = useRouter()

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    fetch(`/api/join/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) setInfo(d)
        else setError(d.error)
      })
      .catch(() => setError('网络错误，请刷新重试'))
  }, [token])

  const handleAccept = async () => {
    if (!session) {
      signIn(undefined, { callbackUrl: `/join/${token}` })
      return
    }
    setJoining(true)
    try {
      const res = await fetch(`/api/join/${token}`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setJoined(true)
        setTimeout(() => {
          if (data.taskId) router.push(`/tasks/${data.taskId}`)
          else router.push('/')
        }, 2000)
      } else {
        setError(data.error)
      }
    } catch {
      setError('加入失败，请重试')
    } finally {
      setJoining(false)
    }
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4">😕</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">邀请链接无效</h1>
        <p className="text-gray-500 mb-6">{error}</p>
        <button onClick={() => router.push('/')} className="text-orange-500 hover:underline">返回首页</button>
      </div>
    </div>
  )

  if (!info) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400">加载中...</div>
    </div>
  )

  if (joined) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">已成功加入！</h1>
        <p className="text-gray-500">正在跳转到任务...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border p-8 max-w-md w-full">
        {/* 邀请人 */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold">
            {info.inviter.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm text-gray-500">邀请你加入</p>
            <p className="font-semibold text-gray-800">{info.inviter.name} 的工作区</p>
          </div>
        </div>

        {/* 任务预览 */}
        {info.task && (
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-6">
            <p className="text-xs text-orange-500 font-medium mb-1">📋 任务</p>
            <p className="font-bold text-gray-800 mb-2">{info.task.title}</p>
            <p className="text-sm text-gray-600 line-clamp-3">{info.task.description}</p>
          </div>
        )}

        {/* 工作区 */}
        <div className="text-sm text-gray-500 mb-6">
          加入后你将成为 <span className="font-medium text-gray-700">「{info.workspace.name}」</span> 的成员，
          可以认领和执行任务中的步骤。
        </div>

        {/* 操作按钮 */}
        {status === 'unauthenticated' ? (
          <div>
            <button
              onClick={handleAccept}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-red-600 transition"
            >
              登录后接受邀请
            </button>
            <p className="text-center text-xs text-gray-400 mt-3">没有账号？<a href="/register" className="text-orange-500 hover:underline">免费注册</a></p>
          </div>
        ) : (
          <button
            onClick={handleAccept}
            disabled={joining}
            className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50"
          >
            {joining ? '加入中...' : '✅ 接受邀请，加入工作区'}
          </button>
        )}
      </div>
    </div>
  )
}

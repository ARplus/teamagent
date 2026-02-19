'use client'

import { useState, useEffect } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface InviteInfo {
  valid: boolean
  inviter: { name: string; avatar: string | null }
  workspace: { name: string }
  task: { id: string; title: string; description: string; status: string } | null
  expiresAt: string
}

export default function JoinPage({ params }: { params: { token: string } }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    fetchInvite()
  }, [])

  const fetchInvite = async () => {
    const res = await fetch(`/api/invite/${params.token}`)
    const data = await res.json()
    if (res.ok) setInvite(data)
    else setError(data.error)
  }

  const acceptInvite = async () => {
    if (!session) {
      // 未登录，跳转登录后回来
      signIn(undefined, { callbackUrl: `/join/${params.token}` })
      return
    }
    setJoining(true)
    const res = await fetch(`/api/invite/${params.token}`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setJoined(true)
      setTimeout(() => {
        router.push(data.taskId ? `/tasks/${data.taskId}` : '/')
      }, 2000)
    } else {
      setError(data.error)
    }
    setJoining(false)
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">😕</div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">邀请链接无效</h2>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <button onClick={() => router.push('/')} className="text-orange-500 hover:underline text-sm">
            返回首页
          </button>
        </div>
      </div>
    )
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 animate-pulse">加载邀请信息...</div>
      </div>
    )
  }

  if (joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">欢迎加入！</h2>
          <p className="text-gray-500 text-sm">正在跳转到任务页面...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full">
        {/* 邀请人信息 */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold">
            {invite.inviter.name?.[0] || '?'}
          </div>
          <div>
            <p className="text-sm text-gray-500">
              <span className="font-semibold text-gray-800">{invite.inviter.name}</span> 邀请你加入
            </p>
            <p className="text-xs text-gray-400">{invite.workspace.name}</p>
          </div>
        </div>

        {/* 任务信息 */}
        {invite.task && (
          <div className="bg-orange-50 rounded-xl p-4 mb-6 border border-orange-100">
            <p className="text-xs text-orange-500 font-medium mb-1">📋 协作任务</p>
            <h3 className="font-semibold text-gray-800 mb-1">{invite.task.title}</h3>
            <p className="text-gray-500 text-xs line-clamp-3">{invite.task.description}</p>
          </div>
        )}

        {/* 登录提示 */}
        {status === 'unauthenticated' && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
            需要先登录才能接受邀请
          </div>
        )}

        {/* 已登录身份显示 */}
        {session && (
          <p className="text-sm text-gray-500 mb-4">
            以 <span className="font-medium text-gray-800">{session.user?.name || session.user?.email}</span> 身份加入
          </p>
        )}

        {/* 接受按钮 */}
        <button
          onClick={acceptInvite}
          disabled={joining}
          className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50"
        >
          {joining ? '加入中...' : session ? '✅ 接受邀请，加入协作' : '🔑 登录并接受邀请'}
        </button>

        <p className="text-center text-xs text-gray-400 mt-4">
          链接有效期至 {new Date(invite.expiresAt).toLocaleDateString('zh-CN')}
        </p>
      </div>
    </div>
  )
}

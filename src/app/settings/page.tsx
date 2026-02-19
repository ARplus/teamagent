'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

interface ApiToken {
  id: string
  name: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

interface Member {
  id: string
  role: string
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
    agent: { id: string; name: string; status: string } | null
  }
}

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 团队成员
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 未登录跳转
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  // 加载 token 列表 + 工作区信息
  useEffect(() => {
    if (session) {
      fetchTokens()
      fetchWorkspace()
    }
  }, [session])

  const fetchWorkspace = async () => {
    try {
      const res = await fetch('/api/workspaces/my')
      const data = await res.json()
      if (data.workspace?.id) {
        setWorkspaceId(data.workspace.id)
        fetchMembers(data.workspace.id)
      }
    } catch (e) {
      console.error('获取工作区失败', e)
    }
  }

  const fetchMembers = async (wsId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${wsId}/members`)
      const data = await res.json()
      setMembers(data.members || [])
    } catch (e) {
      console.error('获取成员失败', e)
    }
  }

  const inviteMember = async () => {
    if (!inviteEmail.trim() || !workspaceId) return
    setInviting(true)
    setInviteMsg(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        setInviteMsg({ type: 'ok', text: data.message })
        setInviteEmail('')
        fetchMembers(workspaceId)
      } else {
        setInviteMsg({ type: 'err', text: data.error })
      }
    } catch (e) {
      setInviteMsg({ type: 'err', text: '邀请失败，请重试' })
    } finally {
      setInviting(false)
    }
  }

  const removeMember = async (userId: string) => {
    if (!workspaceId || !confirm('确定移除该成员？')) return
    try {
      await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      fetchMembers(workspaceId)
    } catch (e) {
      console.error('移除成员失败', e)
    }
  }

  const fetchTokens = async () => {
    try {
      const res = await fetch('/api/tokens')
      const data = await res.json()
      setTokens(data.tokens || [])
    } catch (e) {
      console.error('获取 token 失败', e)
    } finally {
      setLoading(false)
    }
  }

  const createToken = async () => {
    if (!newTokenName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName })
      })
      const data = await res.json()
      if (data.token) {
        setNewToken(data.token)
        setNewTokenName('')
        fetchTokens()
      }
    } catch (e) {
      console.error('创建 token 失败', e)
    } finally {
      setCreating(false)
    }
  }

  const deleteToken = async (id: string) => {
    if (!confirm('确定要删除这个 Token 吗？')) return
    try {
      await fetch('/api/tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      fetchTokens()
    } catch (e) {
      console.error('删除 token 失败', e)
    }
  }

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <>
        <Navbar />
        <main className="max-w-4xl mx-auto px-6 py-8">
          <div className="animate-pulse">加载中...</div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">⚙️ 设置</h1>

        {/* 团队成员管理 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">👥 团队成员</h2>
          <p className="text-gray-500 text-sm mb-5">
            邀请协作者加入你的工作区，任务拆解时可以分配给他们。
          </p>

          {/* 邀请框 */}
          <div className="flex items-center space-x-3 mb-4">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && inviteMember()}
              placeholder="输入协作者邮箱..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
            />
            <button
              onClick={inviteMember}
              disabled={inviting || !inviteEmail.trim()}
              className="px-5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50 text-sm"
            >
              {inviting ? '邀请中...' : '邀请'}
            </button>
          </div>

          {/* 邀请反馈 */}
          {inviteMsg && (
            <div className={`text-sm px-4 py-2 rounded-lg mb-4 ${
              inviteMsg.type === 'ok'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {inviteMsg.text}
            </div>
          )}

          {/* 成员列表 */}
          <div className="space-y-3">
            {members.length === 0 ? (
              <p className="text-gray-400 text-sm">工作区暂无其他成员</p>
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div className="flex items-center space-x-3">
                    {/* 头像 */}
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold text-sm">
                      {(m.user.name || m.user.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-800 text-sm">{m.user.name || m.user.email}</span>
                        {m.role === 'owner' && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Owner</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 flex items-center space-x-2">
                        <span>{m.user.email}</span>
                        {m.user.agent && (
                          <span className="text-blue-500">
                            🤖 {m.user.agent.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {m.role !== 'owner' && (
                    <button
                      onClick={() => removeMember(m.user.id)}
                      className="text-xs text-gray-400 hover:text-red-500 transition"
                    >
                      移除
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* API Token 管理 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">🔑 API Token</h2>
          <p className="text-gray-600 text-sm mb-6">
            API Token 用于让你的本地 Agent（如 Clawdbot）连接 TeamAgent。
            每个 Token 只在创建时显示一次，请妥善保存。
          </p>

          {/* 新创建的 Token 显示 */}
          {newToken && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
              <p className="text-green-800 font-medium mb-2">✅ Token 创建成功！请立即复制保存：</p>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border text-sm font-mono break-all">
                  {newToken}
                </code>
                <button
                  onClick={copyToken}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  {copied ? '已复制!' : '复制'}
                </button>
              </div>
              <p className="text-green-700 text-xs mt-2">
                ⚠️ 关闭此提示后将无法再次查看此 Token
              </p>
              <button
                onClick={() => setNewToken(null)}
                className="text-green-600 text-sm mt-2 hover:underline"
              >
                我已保存，关闭提示
              </button>
            </div>
          )}

          {/* 创建新 Token */}
          <div className="flex items-center space-x-3 mb-6">
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="Token 名称，如：Lobster Skill"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <button
              onClick={createToken}
              disabled={creating || !newTokenName.trim()}
              className="px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50"
            >
              {creating ? '创建中...' : '创建 Token'}
            </button>
          </div>

          {/* Token 列表 */}
          <div className="space-y-3">
            {tokens.length === 0 ? (
              <p className="text-gray-500 text-sm">还没有创建任何 Token</p>
            ) : (
              tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                >
                  <div>
                    <p className="font-medium text-gray-800">{token.name}</p>
                    <p className="text-xs text-gray-500">
                      创建于 {new Date(token.createdAt).toLocaleDateString('zh-CN')}
                      {token.lastUsedAt && (
                        <span> · 最后使用 {new Date(token.lastUsedAt).toLocaleDateString('zh-CN')}</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteToken(token.id)}
                    className="text-red-600 hover:text-red-700 text-sm"
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 使用说明 */}
        <div className="bg-gray-50 rounded-2xl p-6">
          <h3 className="font-semibold text-gray-800 mb-3">📖 如何使用</h3>
          <ol className="text-sm text-gray-600 space-y-2">
            <li>1. 点击上方「创建 Token」生成一个 API Token</li>
            <li>2. 复制 Token 到你的本地 Agent 配置中</li>
            <li>3. 在 Clawdbot 中运行：</li>
            <code className="block bg-white px-4 py-2 rounded mt-1 text-xs">
              node teamagent-client.js set-token ta_xxx...
            </code>
            <li className="mt-2">4. 测试连接：</li>
            <code className="block bg-white px-4 py-2 rounded mt-1 text-xs">
              node teamagent-client.js test
            </code>
          </ol>
        </div>
      </main>
    </>
  )
}

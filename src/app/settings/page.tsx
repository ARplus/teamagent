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
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)

  // F06: 通知偏好
  const [dndEnabled, setDndEnabled] = useState(false)
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('08:00')
  const [minPriority, setMinPriority] = useState('low')
  const [callPopupEnabled, setCallPopupEnabled] = useState(true)
  const [prefSaving, setPrefSaving] = useState(false)
  const [prefMsg, setPrefMsg] = useState<string | null>(null)

  // 未登录跳转
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  // 加载 token 列表 + 工作区信息 + 通知偏好
  useEffect(() => {
    if (session) {
      fetchTokens()
      fetchWorkspace()
      fetchPreferences()
    }
  }, [session])

  const fetchPreferences = async () => {
    try {
      const res = await fetch('/api/user-preferences')
      if (res.ok) {
        const { preference } = await res.json()
        setDndEnabled(preference.dndEnabled)
        setDndStart(preference.dndStart || '22:00')
        setDndEnd(preference.dndEnd || '08:00')
        setMinPriority(preference.minPriority || 'low')
        setCallPopupEnabled(preference.callPopupEnabled ?? true)
      }
    } catch (e) {
      console.error('获取通知偏好失败', e)
    }
  }

  const savePreferences = async () => {
    setPrefSaving(true)
    setPrefMsg(null)
    try {
      const res = await fetch('/api/user-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dndEnabled, dndStart, dndEnd, minPriority, callPopupEnabled }),
      })
      if (res.ok) {
        setPrefMsg('✅ 保存成功')
        setTimeout(() => setPrefMsg(null), 2000)
      } else {
        const d = await res.json()
        setPrefMsg(`❌ ${d.error}`)
      }
    } catch (e) {
      setPrefMsg('❌ 保存失败')
    } finally {
      setPrefSaving(false)
    }
  }

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

  const handleCopyInviteLink = async () => {
    setInviteLoading(true)
    try {
      const res = await fetch('/api/workspace/invite', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.inviteUrl) {
        const url = data.inviteUrl
        const fallback = (text: string) => {
          const el = document.createElement('textarea')
          el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'
          document.body.appendChild(el); el.focus(); el.select()
          document.execCommand('copy'); document.body.removeChild(el)
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).catch(() => fallback(url))
        } else {
          fallback(url)
        }
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 2500)
      }
    } catch { /* ignore */ }
    finally { setInviteLoading(false) }
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
      const fallback = () => {
        const el = document.createElement('textarea')
        el.value = newToken
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.focus()
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(newToken).catch(fallback)
      } else {
        fallback()
      }
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

          {/* 邀请链接按钮 */}
          <div className="mb-4">
            <button
              onClick={handleCopyInviteLink}
              disabled={inviteLoading}
              className={`px-5 py-2.5 rounded-lg transition text-sm font-medium flex items-center gap-2 ${
                inviteCopied
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600'
              } disabled:opacity-50`}
            >
              <span>{inviteCopied ? '✓' : '🔗'}</span>
              <span>{inviteLoading ? '生成中...' : inviteCopied ? '邀请链接已复制！' : '复制邀请链接'}</span>
            </button>
            <p className="text-xs text-gray-400 mt-2">生成 7 天有效的邀请链接，发给协作伙伴即可加入你的工作区</p>
          </div>

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

        {/* F06: 通知偏好 / 免打扰 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">🔔 通知偏好</h2>
          <p className="text-gray-500 text-sm mb-5">
            设置免打扰时段和 Agent 呼叫通知方式。
          </p>

          <div className="space-y-5">
            {/* 免打扰开关 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-800 text-sm">🌙 免打扰模式</div>
                <div className="text-xs text-gray-400">开启后，在指定时段内不推送普通/低优通知（紧急呼叫仍然推送）</div>
              </div>
              <button
                onClick={() => setDndEnabled(!dndEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  dndEnabled ? 'bg-orange-500' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  dndEnabled ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            {/* 免打扰时段 */}
            {dndEnabled && (
              <div className="flex items-center gap-3 pl-4 border-l-2 border-orange-200">
                <span className="text-sm text-gray-600">从</span>
                <input
                  type="time"
                  value={dndStart}
                  onChange={e => setDndStart(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
                <span className="text-sm text-gray-600">到</span>
                <input
                  type="time"
                  value={dndEnd}
                  onChange={e => setDndEnd(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
            )}

            {/* 最低通知级别 */}
            <div>
              <div className="font-medium text-gray-800 text-sm mb-2">📊 推送通知级别</div>
              <div className="flex gap-3">
                {[
                  { value: 'low', label: '全部', desc: '接收所有通知', color: 'green' },
                  { value: 'normal', label: '普通+紧急', desc: '过滤低优通知', color: 'yellow' },
                  { value: 'urgent', label: '仅紧急', desc: '只推送紧急呼叫', color: 'red' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setMinPriority(opt.value)}
                    className={`flex-1 p-3 rounded-xl border-2 transition-all text-left ${
                      minPriority === opt.value
                        ? `border-${opt.color}-400 bg-${opt.color}-50`
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`text-sm font-medium ${
                      minPriority === opt.value ? `text-${opt.color}-700` : 'text-gray-700'
                    }`}>{opt.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 呼叫弹窗 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-800 text-sm">📞 Agent 呼叫弹窗</div>
                <div className="text-xs text-gray-400">Agent 发起呼叫时在页面右上角显示弹窗通知</div>
              </div>
              <button
                onClick={() => setCallPopupEnabled(!callPopupEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  callPopupEnabled ? 'bg-orange-500' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  callPopupEnabled ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            {/* 保存按钮 */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={savePreferences}
                disabled={prefSaving}
                className="px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50 text-sm"
              >
                {prefSaving ? '保存中...' : '保存偏好'}
              </button>
              {prefMsg && <span className="text-sm text-gray-600">{prefMsg}</span>}
            </div>
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
          <h3 className="font-semibold text-gray-800 mb-3">📖 如何使用 API Token</h3>
          <ol className="text-sm text-gray-600 space-y-3">
            <li>1. 点击上方「创建 Token」生成一个 API Token</li>
            <li>2. 复制 Token（创建后只显示一次！）</li>
            <li>3. 在 Claude Code 中安装 TeamAgent Skill：</li>
            <code className="block bg-white px-4 py-2 rounded mt-1 text-xs font-mono">
              openclaw skill install teamagent
            </code>
            <li className="mt-2">4. 运行注册命令，按提示粘贴 Token：</li>
            <code className="block bg-white px-4 py-2 rounded mt-1 text-xs font-mono">
              /ta-register
            </code>
            <li className="mt-2">5. 在 TeamAgent 网页输入 6 位配对码完成绑定</li>
          </ol>
          <p className="text-xs text-gray-400 mt-4">
            Token 用于 Agent 连接 TeamAgent 服务。如果 Token 泄露，请立即删除并重新创建。
          </p>
        </div>
      </main>
    </>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Navbar'

export default function NewTaskPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    mode: 'solo',
    assigneeEmail: '',
    dueDate: ''
  })

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return

    setLoading(true)
    try {
      // 先创建或获取默认工作区
      console.log('[DEBUG] 获取工作区...')
      const wsRes = await fetch('/api/workspaces')
      console.log('[DEBUG] wsRes.status:', wsRes.status)
      
      if (!wsRes.ok) {
        const errText = await wsRes.text()
        console.error('[DEBUG] 获取工作区失败:', errText)
        alert('获取工作区失败: ' + errText)
        setLoading(false)
        return
      }
      
      const workspaces = await wsRes.json()
      console.log('[DEBUG] workspaces:', workspaces)
      
      let workspaceId: string
      if (!Array.isArray(workspaces) || workspaces.length === 0) {
        console.log('[DEBUG] 没有工作区，创建默认...')
        const createRes = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '默认工作区' })
        })
        const newWs = await createRes.json()
        console.log('[DEBUG] 新工作区:', newWs)
        workspaceId = newWs.id
      } else {
        workspaceId = workspaces[0].id
      }
      
      console.log('[DEBUG] workspaceId:', workspaceId)

      // 创建任务
      const taskData = {
        ...form,
        workspaceId,
        dueDate: form.dueDate || null
      }
      console.log('[DEBUG] 创建任务:', taskData)
      
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData)
      })

      console.log('[DEBUG] res.status:', res.status)
      
      if (res.ok) {
        router.push('/')
      } else {
        const err = await res.json()
        console.error('[DEBUG] 创建失败:', err)
        alert(err.error || '创建失败')
      }
    } catch (e) {
      console.error('[DEBUG] 异常:', e)
      alert('创建任务失败')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading') {
    return (
      <>
        <Navbar />
        <main className="max-w-2xl mx-auto px-6 py-8">
          <div className="animate-pulse">加载中...</div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">📝 创建新任务</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              任务标题 *
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="例如：整理会议纪要"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              required
            />
          </div>

          {/* 任务模式选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              任务模式
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'solo' })}
                className={`relative p-4 rounded-xl border-2 text-left transition ${
                  form.mode === 'solo'
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">🤖</span>
                  <span className={`font-semibold ${form.mode === 'solo' ? 'text-orange-700' : 'text-gray-700'}`}>
                    Solo 模式
                  </span>
                  {form.mode === 'solo' && (
                    <span className="ml-auto text-orange-500 text-xs font-medium bg-orange-100 px-2 py-0.5 rounded-full">已选</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">AI 团队内部协作，步骤由 Agent 自动认领执行</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'team' })}
                className={`relative p-4 rounded-xl border-2 text-left transition ${
                  form.mode === 'team'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">👥</span>
                  <span className={`font-semibold ${form.mode === 'team' ? 'text-blue-700' : 'text-gray-700'}`}>
                    Team 模式
                  </span>
                  {form.mode === 'team' && (
                    <span className="ml-auto text-blue-500 text-xs font-medium bg-blue-100 px-2 py-0.5 rounded-full">已选</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">外部人类协作，邀请团队成员共同完成任务</p>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              任务描述
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="详细描述任务内容、要求、验收标准等..."
              rows={5}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              分配给（邮箱）
            </label>
            <input
              type="email"
              value={form.assigneeEmail}
              onChange={(e) => setForm({ ...form, assigneeEmail: e.target.value })}
              placeholder="例如：lobster@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              优先级
            </label>
            <div className="flex space-x-4">
              {[
                { value: 'low', label: '低', color: 'bg-gray-100 text-gray-600' },
                { value: 'medium', label: '中', color: 'bg-blue-100 text-blue-600' },
                { value: 'high', label: '高', color: 'bg-orange-100 text-orange-600' },
                { value: 'urgent', label: '紧急', color: 'bg-red-100 text-red-600' }
              ].map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setForm({ ...form, priority: p.value })}
                  className={`px-4 py-2 rounded-lg transition ${
                    form.priority === p.value
                      ? p.color + ' ring-2 ring-offset-2 ring-gray-400'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              截止日期
            </label>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div className="flex space-x-4 pt-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !form.title.trim()}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl hover:from-orange-600 hover:to-red-600 transition disabled:opacity-50"
            >
              {loading ? '创建中...' : '创建任务'}
            </button>
          </div>
        </form>
      </main>
    </>
  )
}

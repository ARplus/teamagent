'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useAgentEvents, TeamAgentEvent } from '@/hooks/useAgentEvents'

interface Toast {
  id: string
  type: 'info' | 'success' | 'warning' | 'urgent'
  title: string
  message: string
  timestamp: number
  persistent?: boolean   // F06: 紧急呼叫不自动消失
  callId?: string        // F06: 关联呼叫 ID
}

/**
 * 实时事件通知组件
 * 
 * 放在布局中，自动显示所有实时事件
 */
export function EventToast({ onTaskUpdate }: { onTaskUpdate?: () => void }) {
  const { data: session } = useSession()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showStatus, setShowStatus] = useState(true)
  const [hasAgent, setHasAgent] = useState(false)

  // 检查用户是否有 Agent — 无 Agent 时不显示连接状态
  useEffect(() => {
    if (!session) return
    fetch('/api/agents/mine')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.agent) setHasAgent(true) })
      .catch(() => {})
  }, [session])

  const addToast = (type: Toast['type'], title: string, message: string, opts?: { persistent?: boolean; callId?: string }) => {
    const toast: Toast = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      title,
      message,
      timestamp: Date.now(),
      persistent: opts?.persistent,
      callId: opts?.callId,
    }

    setToasts(prev => {
      // 最多显示 5 个通知（紧急通知可能驻留）
      const newToasts = [...prev, toast]
      return newToasts.slice(-5)
    })

    // 紧急呼叫通知不自动消失，其他 5 秒后消失
    if (!opts?.persistent) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id))
      }, 5000)
    }
  }

  const { connected, reconnecting, disconnect } = useAgentEvents({
    enabled: !!session, // 只在登录后启用 SSE
    onEvent: (event: TeamAgentEvent) => {
      // 只处理重要事件，忽略 connected（太频繁）
      switch (event.type) {
        case 'task:created':
          addToast('info', '📝 新任务', event.title)
          onTaskUpdate?.()
          break
        
        case 'step:ready':
          addToast('warning', '🎯 轮到你了', `步骤：${event.title}`)
          onTaskUpdate?.()
          break
        
        case 'approval:requested':
          addToast('warning', '👀 等待审核', `步骤：${event.title}`)
          onTaskUpdate?.()
          window.dispatchEvent(new CustomEvent('teamagent:task-refresh', { detail: { taskId: event.taskId } }))
          break

        case 'approval:granted':
          addToast('success', '✅ 审核通过', '步骤已完成')
          onTaskUpdate?.()
          window.dispatchEvent(new CustomEvent('teamagent:task-refresh', { detail: { taskId: event.taskId } }))
          break

        case 'step:waiting-human':
          addToast('warning', '⏸️ 需要你的输入', `步骤「${event.title}」需要你提供内容`)
          onTaskUpdate?.()
          window.dispatchEvent(new CustomEvent('teamagent:task-refresh', { detail: { taskId: event.taskId } }))
          break

        case 'step:commented':
          addToast('info', '💬 新评论', `${event.authorName} 发表了评论`)
          onTaskUpdate?.()
          break

        case 'step:mentioned': {
          // 如果当前用户就是评论作者 → 不弹通知（Agent 通过 agent-worker 处理）
          const currentUserId = (session?.user as any)?.id
          if (currentUserId && (event as any).authorId === currentUserId) {
            onTaskUpdate?.()
            break
          }
          // 清理 @[DisplayName](userId) → @DisplayName
          const rawContent = (event as any).content || ''
          const cleanContent = rawContent.replace(/@\[[^\]]+\]\([^)]+\)/g, (m: string) => {
            const name = m.match(/@\[([^\]]+)\]/)?.[1] || ''
            return `@${name}`
          }).substring(0, 50)
          addToast('warning', '📣 有人@你', `${event.authorName}: ${cleanContent || '提到了你'}`)
          onTaskUpdate?.()
          break
        }

        // B04: AI 后台拆解完成，自动刷新步骤列表
        case 'task:parsed':
          addToast('success', '🤖 AI 拆解完成', `已生成 ${event.stepCount || ''} 个步骤`)
          onTaskUpdate?.()
          // 广播自定义事件，让 page.tsx 自动刷新当前任务
          window.dispatchEvent(new CustomEvent('teamagent:task-parsed', { detail: { taskId: event.taskId } }))
          break

        case 'task:evaluating':
          addToast('info', '📊 评分进行中', `${(event as any).agentName || '主Agent'} 正在为任务评分...`)
          break

        case 'task:evaluated':
          addToast('success', '🏆 评分完成', `${(event as any).reviewerName || '评审官'} 已为 ${(event as any).count} 位成员评分`)
          onTaskUpdate?.()
          break

        // #3: Agent 主动发消息 / 人类发消息后 Agent 回复 → 通知前端刷新聊天
        case 'chat:incoming':
          // 只有 Agent 发的消息才弹通知（fromAgent=true），人类自己发的不弹
          if ((event as any).fromAgent) {
            addToast('info', '💬 新消息', (event as any).content?.substring(0, 60) || '收到新消息')
          }
          // 无论谁发的都刷新聊天页面
          window.dispatchEvent(new CustomEvent('teamagent:chat-refresh'))
          break

        // 频道群聊消息
        case 'channel:message':
          addToast('info', '📢 频道消息', `${(event as any).senderName}: ${(event as any).content?.substring(0, 50) || '新消息'}`)
          window.dispatchEvent(new CustomEvent('teamagent:channel-refresh', {
            detail: { channelId: (event as any).channelId }
          }))
          break

        // 频道 @mention
        case 'channel:mention':
          addToast('warning', '📢 频道提及', `${(event as any).senderName} 在 #${(event as any).channelName || '频道'} 提到了你`)
          window.dispatchEvent(new CustomEvent('teamagent:channel-refresh', {
            detail: { channelId: (event as any).channelId }
          }))
          break

        // 🆕 军团成长：Agent 升级庆祝
        case 'agent:level-up':
          addToast('success', '🎖️ 等级提升！', `恭喜升到 Lv.${(event as any).newLevel}！继续加油！`)
          onTaskUpdate?.()
          break

        // F06: Agent 主动呼叫
        case 'agent:calling':
          if (event.priority === 'urgent') {
            addToast('urgent', `🚨 ${event.agentName} 紧急呼叫`, event.title, { persistent: true, callId: event.callId })
          } else {
            addToast('warning', `📞 ${event.agentName} 呼叫你`, event.title, { callId: event.callId })
          }
          onTaskUpdate?.()
          break

        // 日程提醒 — 振动手机
        case 'schedule:reminder': {
          const emoji = (event as any).emoji || '📅'
          const title = (event as any).title || '日程提醒'
          const mins = (event as any).minutesBefore
          const timeHint = mins > 0 ? `${mins}分钟后` : '现在'
          addToast('warning', `${emoji} 日程提醒`, `${title} · ${timeHint}`, { persistent: true })
          // 手机振动（Vibration API）
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 100, 200, 100, 200])
          }
          break
        }

        // 定时任务触发
        case 'scheduled:triggered':
          addToast('info', '⏰ 定时任务触发', `已自动创建任务`)
          onTaskUpdate?.()
          break
      }
    }
  })

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // F06: 回应 Agent 呼叫
  const respondToCall = async (callId: string, action: 'accept' | 'decline', toastId: string) => {
    try {
      await fetch(`/api/agent-calls/${callId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      removeToast(toastId)
    } catch (e) {
      console.error('回应呼叫失败:', e)
    }
  }

  return (
    <>
      {/* 连接状态指示器 — 仅有 Agent 时显示，桌面端左下角，移动端隐藏 */}
      {hasAgent && (
        <div className="hidden md:block fixed bottom-4 left-4 z-50">
          <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs transition-all ${
            connected
              ? 'bg-green-100 text-green-700'
              : reconnecting
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              connected ? 'bg-green-500 animate-pulse'
              : reconnecting ? 'bg-amber-400 animate-ping'
              : 'bg-gray-400'
            }`} />
            <span>{connected ? '实时连接中' : reconnecting ? '重连中...' : '未连接'}</span>
          </div>
        </div>
      )}

      {/* Toast 容器 */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`
              p-4 rounded-xl shadow-lg border backdrop-blur-sm
              transform transition-all duration-300 ease-out
              animate-slide-in
              ${toast.type === 'success' ? 'bg-green-50 border-green-200' : ''}
              ${toast.type === 'warning' ? 'bg-yellow-50 border-yellow-200' : ''}
              ${toast.type === 'info' ? 'bg-blue-50 border-blue-200' : ''}
              ${toast.type === 'urgent' ? 'bg-red-50 border-red-300 ring-2 ring-red-200' : ''}
            `}
            onClick={() => !toast.persistent && removeToast(toast.id)}
          >
            <div className="font-medium text-sm text-gray-900">
              {toast.title}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">
              {toast.message}
            </div>
            {/* F06: 呼叫回应按钮 */}
            {toast.callId && (
              <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                <button
                  className="text-xs px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                  onClick={() => respondToCall(toast.callId!, 'accept', toast.id)}
                >
                  ✅ 接受
                </button>
                <button
                  className="text-xs px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  onClick={() => respondToCall(toast.callId!, 'decline', toast.id)}
                >
                  ❌ 拒绝
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </>
  )
}

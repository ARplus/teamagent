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
          break
        
        case 'approval:granted':
          addToast('success', '✅ 审核通过', '步骤已完成')
          onTaskUpdate?.()
          break

        case 'step:commented':
          addToast('info', '💬 新评论', `${event.authorName} 发表了评论`)
          onTaskUpdate?.()
          break

        case 'step:mentioned':
          addToast('warning', '📣 有人@你', `${event.authorName}: ${(event as any).content?.substring(0, 50) || '提到了你'}`)
          onTaskUpdate?.()
          break

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

        // F06: Agent 主动呼叫
        case 'agent:calling':
          if (event.priority === 'urgent') {
            addToast('urgent', `🚨 ${event.agentName} 紧急呼叫`, event.title, { persistent: true, callId: event.callId })
          } else {
            addToast('warning', `📞 ${event.agentName} 呼叫你`, event.title, { callId: event.callId })
          }
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
      {/* 连接状态指示器 — 桌面端显示在左下角，移动端隐藏（移动端用 tab 内联状态） */}
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

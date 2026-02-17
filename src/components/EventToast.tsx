'use client'

import { useEffect, useState } from 'react'
import { useAgentEvents, TeamAgentEvent } from '@/hooks/useAgentEvents'

interface Toast {
  id: string
  type: 'info' | 'success' | 'warning'
  title: string
  message: string
  timestamp: number
}

/**
 * 实时事件通知组件
 * 
 * 放在布局中，自动显示所有实时事件
 */
export function EventToast({ onTaskUpdate }: { onTaskUpdate?: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showStatus, setShowStatus] = useState(true)

  const addToast = (type: Toast['type'], title: string, message: string) => {
    const toast: Toast = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      title,
      message,
      timestamp: Date.now()
    }
    
    setToasts(prev => {
      // 最多显示 3 个通知
      const newToasts = [...prev, toast]
      return newToasts.slice(-3)
    })

    // 5 秒后自动消失
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toast.id))
    }, 5000)
  }

  const { connected, disconnect } = useAgentEvents({
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
      }
    }
  })

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <>
      {/* 连接状态指示器 */}
      <div className="fixed bottom-4 left-4 z-50">
        <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs ${
          connected 
            ? 'bg-green-100 text-green-700' 
            : 'bg-gray-100 text-gray-500'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
          }`} />
          <span>{connected ? '实时连接中' : '未连接'}</span>
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
            `}
            onClick={() => removeToast(toast.id)}
          >
            <div className="font-medium text-sm text-gray-900">
              {toast.title}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">
              {toast.message}
            </div>
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

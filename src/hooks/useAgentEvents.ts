'use client'

import { useEffect, useRef, useState } from 'react'

// 事件类型（与服务端一致）
export type TeamAgentEvent = 
  | { type: 'connected'; agentId: string; agentName: string; message: string }
  | { type: 'task:created'; taskId: string; title: string }
  | { type: 'task:updated'; taskId: string; title: string }
  | { type: 'step:ready'; taskId: string; stepId: string; title: string }
  | { type: 'step:completed'; taskId: string; stepId: string; title: string; nextStepId?: string }
  | { type: 'step:assigned'; taskId: string; stepId: string; title: string }
  | { type: 'approval:requested'; taskId: string; stepId: string; title: string }
  | { type: 'approval:granted'; taskId: string; stepId: string }
  | { type: 'approval:rejected'; taskId: string; stepId: string; reason?: string }
  | { type: 'workflow:changed'; taskId: string; change: string }
  | { type: 'ping' }

interface UseAgentEventsOptions {
  onEvent?: (event: TeamAgentEvent) => void
  enabled?: boolean
}

/**
 * 订阅 Agent 实时事件的 Hook
 * 
 * 简化版本，避免 React Strict Mode 导致的重复连接
 */
export function useAgentEvents(options: UseAgentEventsOptions = {}) {
  const { onEvent, enabled = true } = options

  const eventSourceRef = useRef<EventSource | null>(null)
  const [connected, setConnected] = useState(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    // 防止 Strict Mode 重复挂载
    if (mountedRef.current) return
    if (!enabled) return
    
    mountedRef.current = true

    console.log('[SSE] 连接中...')
    const eventSource = new EventSource('/api/agent/subscribe')
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      console.log('[SSE] 已连接')
      setConnected(true)
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TeamAgentEvent
        
        // 忽略心跳和连接消息
        if (data.type === 'ping' || data.type === 'connected') return
        
        console.log('[SSE] 收到事件:', data)
        onEvent?.(data)
      } catch (error) {
        console.error('[SSE] 解析事件失败:', error)
      }
    }

    eventSource.onerror = () => {
      console.log('[SSE] 连接错误，不自动重连')
      setConnected(false)
      eventSource.close()
      eventSourceRef.current = null
    }

    return () => {
      console.log('[SSE] 清理连接')
      eventSource.close()
      eventSourceRef.current = null
      mountedRef.current = false
    }
  }, [enabled, onEvent])

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setConnected(false)
      mountedRef.current = false
    }
  }

  return {
    connected,
    disconnect
  }
}

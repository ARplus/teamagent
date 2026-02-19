'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

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
 */
export function useAgentEvents(options: UseAgentEventsOptions = {}) {
  const { onEvent, enabled = true } = options

  const eventSourceRef = useRef<EventSource | null>(null)
  const [connected, setConnected] = useState(false)
  const onEventRef = useRef(onEvent)
  
  // 保持 onEvent 回调最新
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    // 不启用时不连接
    if (!enabled) {
      return
    }

    // 已经有连接了
    if (eventSourceRef.current) {
      return
    }

    const eventSource = new EventSource('/api/agent/subscribe')
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setConnected(true)
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TeamAgentEvent
        
        // 忽略心跳和连接消息
        if (data.type === 'ping' || data.type === 'connected') return
        
        onEventRef.current?.(data)
      } catch {
        // 静默处理解析错误
      }
    }

    eventSource.onerror = () => {
      // 静默处理连接错误（可能是未登录导致的 401）
      setConnected(false)
      eventSource.close()
      eventSourceRef.current = null
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      setConnected(false)
    }
  }, [enabled])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setConnected(false)
    }
  }, [])

  return {
    connected,
    disconnect
  }
}

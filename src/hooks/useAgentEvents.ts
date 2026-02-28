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
  | { type: 'chat:incoming'; msgId: string; content: string; senderName?: string }
  | { type: 'step:commented'; taskId: string; stepId: string; commentId: string; authorName: string }
  // B04: AI 后台拆解完成
  | { type: 'task:parsed'; taskId: string; stepCount: number; engine: string }
  // F06: Agent 主动呼叫
  | { type: 'agent:calling'; callId: string; priority: 'urgent' | 'normal' | 'low'; title: string; content: string; agentName: string; taskId?: string; stepId?: string }
  | { type: 'agent:call-responded'; callId: string; action: string; message?: string; respondedBy: string }
  | { type: 'ping' }

interface UseAgentEventsOptions {
  onEvent?: (event: TeamAgentEvent) => void
  enabled?: boolean
}

// 指数退避重连间隔（ms）
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000]

/**
 * 订阅 Agent 实时事件的 Hook（含自动重连）
 */
export function useAgentEvents(options: UseAgentEventsOptions = {}) {
  const { onEvent, enabled = true } = options

  const eventSourceRef = useRef<EventSource | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)

  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const onEventRef = useRef(onEvent)

  // 保持 onEvent 回调最新
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    const eventSource = new EventSource('/api/agent/subscribe')
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      if (!mountedRef.current) return
      setConnected(true)
      setReconnecting(false)
      retryCountRef.current = 0  // 连上了就重置重试计数
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TeamAgentEvent
        if (data.type === 'ping' || data.type === 'connected') return
        onEventRef.current?.(data)
      } catch {
        // 静默处理解析错误
      }
    }

    eventSource.onerror = () => {
      if (!mountedRef.current) return
      setConnected(false)
      eventSource.close()
      eventSourceRef.current = null

      // ✅ 自动重连（指数退避）
      const delay = RETRY_DELAYS[Math.min(retryCountRef.current, RETRY_DELAYS.length - 1)]
      retryCountRef.current++
      setReconnecting(true)

      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, delay)
    }
  }, [enabled])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) connect()

    return () => {
      mountedRef.current = false
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setConnected(false)
      setReconnecting(false)
    }
  }, [enabled, connect])

  const disconnect = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setConnected(false)
    setReconnecting(false)
  }, [])

  return { connected, reconnecting, disconnect }
}

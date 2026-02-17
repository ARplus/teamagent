'use client'

import { useSession } from 'next-auth/react'
import { EventToast } from './EventToast'

/**
 * EventToast 的包装器
 * 只在用户登录时显示实时通知
 */
export function EventToastWrapper() {
  const { status } = useSession()

  // 只有登录用户才连接 SSE
  if (status !== 'authenticated') {
    return null
  }

  return <EventToast />
}

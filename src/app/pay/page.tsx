'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function PayPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const triggered = useRef(false)

  useEffect(() => {
    // 未登录 → 跳注册页（保留 plan 参数）
    if (status === 'unauthenticated') {
      const plan = new URLSearchParams(window.location.search).get('plan') || 'ultimate'
      router.replace(`/register?autoBuy=${plan}`)
      return
    }

    if (status !== 'authenticated' || !session?.user || triggered.current) return
    triggered.current = true

    const plan = new URLSearchParams(window.location.search).get('plan') || 'ultimate'

    // 直接调支付 API → 拿到表单 → 自动提交跳支付宝
    fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: plan }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.formHtml) {
          const div = document.createElement('div')
          div.innerHTML = data.formHtml
          document.body.appendChild(div)
          const form = div.querySelector('form')
          if (form) form.submit()
        } else {
          alert(data.error || '创建订单失败')
          router.replace('/settings')
        }
      })
      .catch(() => {
        alert('支付失败，请稍后重试')
        router.replace('/settings')
      })
  }, [status, session, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex flex-col items-center justify-center">
      <div className="text-5xl mb-4">🦞</div>
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-orange-500 mb-4" />
      <p className="text-gray-600 font-medium">正在跳转支付宝...</p>
      <p className="text-gray-400 text-sm mt-2">请稍候，即将为你开通尊享版</p>
    </div>
  )
}

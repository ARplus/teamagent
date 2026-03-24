/**
 * POST /api/payment/notify
 * 支付宝异步回调 — 验签 + 充 Token
 * 支付宝要求返回纯文本 "success" 表示处理成功
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyNotifySign, PLANS } from '@/lib/alipay'
import { generateToken, hashToken } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  try {
    // 1. 解析 form-urlencoded body
    // 注意：form-urlencoded 中 + 代表空格，decodeURIComponent 不处理 +
    // 必须先把 + 替换为 %20 再 decode
    const text = await req.text()
    const params: Record<string, string> = {}
    for (const pair of text.split('&')) {
      const idx = pair.indexOf('=')
      if (idx === -1) continue
      const key = pair.substring(0, idx)
      const val = pair.substring(idx + 1)
      if (key) {
        params[decodeURIComponent(key.replace(/\+/g, '%20'))] =
          decodeURIComponent(val.replace(/\+/g, '%20'))
      }
    }

    console.log('[Payment] Notify received:', params.out_trade_no, params.trade_status)
    console.log('[Payment] Notify app_id:', params.app_id, '| notify_type:', params.notify_type)

    // 2. 验签 — decoded params + V2 (raw=true, SDK不再decode)
    console.log('[Payment] 验签 sign 长度:', params.sign?.length, 'sign_type:', params.sign_type)
    // 构造签名字符串用于调试
    const debugSignStr = Object.keys(params).sort().filter(k => k !== 'sign' && k !== 'sign_type' && k)
      .map(k => `${k}=${params[k]}`).join('&')
    console.log('[Payment] 验签字符串前200:', debugSignStr.substring(0, 200))
    const signValid = verifyNotifySign(params)
    if (!signValid) {
      console.error('[Payment] 签名验证失败:', params.out_trade_no, '| sign前30:', params.sign?.substring(0, 30))
      console.error('[Payment] 参数keys:', Object.keys(params).sort().join(','))
      return new Response('fail', { status: 200 })
    }

    // 3. 检查交易状态
    if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
      console.log('[Payment] 交易状态非成功:', params.trade_status)
      return new Response('success', { status: 200 })
    }

    // 4. 查找订单
    const outTradeNo = params.out_trade_no
    const order = await prisma.paymentOrder.findUnique({
      where: { outTradeNo },
    })

    if (!order) {
      console.error('[Payment] 订单不存在:', outTradeNo)
      return new Response('fail', { status: 200 })
    }

    // 5. 幂等：已处理的订单直接返回 success
    if (order.status === 'paid') {
      console.log('[Payment] 订单已处理，跳过:', outTradeNo)
      return new Response('success', { status: 200 })
    }

    // 6. 金额校验（支付宝回传的是元，订单存的是分）
    const notifyAmountFen = Math.round(parseFloat(params.total_amount || '0') * 100)
    if (notifyAmountFen !== order.amount) {
      console.error('[Payment] 金额不匹配:', notifyAmountFen, '!=', order.amount)
      return new Response('fail', { status: 200 })
    }

    // 7. 原子操作：更新订单 + 充 Token
    await prisma.$transaction([
      prisma.paymentOrder.update({
        where: { outTradeNo },
        data: {
          status: 'paid',
          tradeNo: params.trade_no || null,
          paidAt: new Date(),
        },
      }),
      prisma.user.update({
        where: { id: order.userId },
        data: {
          creditBalance: { increment: order.credits },
        },
      }),
    ])

    // 8. 自动创建 API Token（如果用户还没有）
    const existingToken = await prisma.apiToken.findFirst({
      where: { userId: order.userId },
    })
    if (!existingToken) {
      const rawToken = generateToken()
      const hashed = hashToken(rawToken)
      await prisma.apiToken.create({
        data: {
          token: hashed,
          displayToken: rawToken,
          name: '支付自动生成',
          userId: order.userId,
        },
      })
      console.log('[Payment] 🔑 自动创建 Token:', order.userId)
    }

    console.log('[Payment] ✅ 充值成功:', outTradeNo, '+', order.credits, 'Token')
    return new Response('success', { status: 200 })
  } catch (error: any) {
    console.error('[Payment] Notify error:', error)
    return new Response('fail', { status: 200 })
  }
}

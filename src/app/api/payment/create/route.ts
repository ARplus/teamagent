/**
 * POST /api/payment/create
 * 创建支付宝支付订单，返回跳转表单 HTML
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { PLANS, createPagePayment, generateOutTradeNo } from '@/lib/alipay'

export async function POST(req: NextRequest) {
  try {
    // 1. 认证
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 2. 解析套餐
    const { planId } = await req.json()
    const plan = PLANS[planId]
    if (!plan) {
      return NextResponse.json({ error: '无效的套餐' }, { status: 400 })
    }

    // 3. 生成订单号
    const outTradeNo = generateOutTradeNo()

    // 4. 创建订单记录
    await prisma.paymentOrder.create({
      data: {
        outTradeNo,
        userId: session.user.id,
        planId,
        amount: Math.round(plan.price * 100), // 元 → 分
        credits: plan.credits,
        status: 'pending',
      },
    })

    // 5. 调支付宝生成表单
    const formHtml = await createPagePayment({
      outTradeNo,
      totalAmount: plan.price.toFixed(2),
      subject: `TeamAgent ${plan.name} - ${plan.desc}`,
      body: `TeamAgent Token 充值 ${plan.name}`,
    })

    return NextResponse.json({ formHtml, outTradeNo })
  } catch (error: any) {
    console.error('[Payment] Create error:', error)
    return NextResponse.json(
      { error: '创建订单失败，请稍后重试' },
      { status: 500 }
    )
  }
}

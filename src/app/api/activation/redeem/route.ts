/**
 * 兑换激活码
 * POST /api/activation/redeem
 * Body: { code: "ABCD1234" }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    // 1. Session 认证
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, creditBalance: true },
    })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 401 })
    }

    // 2. 解析请求
    const body = await req.json()
    const code = (body.code || '').trim().toUpperCase()

    if (!code || code.length < 6) {
      return NextResponse.json({ error: '请输入有效的激活码' }, { status: 400 })
    }

    // 3. 查找激活码
    const activation = await prisma.activationCode.findUnique({
      where: { code },
    })

    if (!activation) {
      return NextResponse.json({ error: '激活码不存在，请检查是否输入正确' }, { status: 404 })
    }

    if (activation.usedAt) {
      return NextResponse.json({ error: '该激活码已被使用' }, { status: 400 })
    }

    if (activation.expiresAt < new Date()) {
      return NextResponse.json({ error: '该激活码已过期' }, { status: 400 })
    }

    // 4. 原子操作：标记使用 + 增加余额
    const [updatedCode, updatedUser] = await prisma.$transaction([
      prisma.activationCode.update({
        where: { id: activation.id },
        data: {
          usedAt: new Date(),
          usedByUserId: user.id,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          creditBalance: { increment: activation.credits },
        },
      }),
    ])

    const newBalance = updatedUser.creditBalance

    console.log(`[Activation] ✅ ${session.user.email} 兑换 ${code} → +${activation.credits} 积分 (余额: ${newBalance})`)

    return NextResponse.json({
      success: true,
      creditsAdded: activation.credits,
      newBalance,
      message: `兑换成功！获得 ${activation.credits} 积分`,
    })
  } catch (error) {
    console.error('[Activation/Redeem] 失败:', error)
    return NextResponse.json({ error: '兑换失败，请重试' }, { status: 500 })
  }
}

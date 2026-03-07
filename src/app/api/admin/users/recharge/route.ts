/**
 * 管理员：给用户直接充值（已付款 → 加积分 + 自动生成 token）
 * POST /api/admin/users/recharge
 * Body: { userId?: string, phone?: string, credits: number, note?: string }
 *
 * 支持按 userId 或 phone 查找用户
 * 如果用户没有 API Token，自动生成一个并返回明文（仅此一次）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAdmin } from '@/lib/admin-auth'
import { generateToken, hashToken } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  try {
    const admin = await authenticateAdmin(req)
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { userId, phone, credits, note } = body

    if ((!userId && !phone) || !credits || credits < 1 || credits > 100000) {
      return NextResponse.json({ error: '参数错误：需要 userId 或 phone，以及 credits(1-100000)' }, { status: 400 })
    }

    // 按 userId 或 phone 查用户
    let user
    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, phone: true, creditBalance: true },
      })
    } else if (phone) {
      const cleanPhone = phone.replace(/\s|-/g, '').trim()
      user = await prisma.user.findUnique({
        where: { phone: cleanPhone },
        select: { id: true, name: true, email: true, phone: true, creditBalance: true },
      })
    }
    if (!user) {
      return NextResponse.json({ error: userId ? '用户不存在' : `手机号 ${phone} 未找到对应用户` }, { status: 404 })
    }

    // 检查是否已有 API Token
    const existingToken = await prisma.apiToken.findFirst({
      where: { userId: user.id },
      select: { id: true },
    })

    let newTokenPlaintext: string | null = null

    // 事务：加积分 + 可能创建 token
    await prisma.$transaction(async (tx) => {
      // 1. 增加积分
      await tx.user.update({
        where: { id: user!.id },
        data: { creditBalance: { increment: credits } },
      })

      // 2. 如果没有 token，自动生成（明文存 displayToken 供用户设置页查看）
      if (!existingToken) {
        newTokenPlaintext = generateToken()
        const hashed = hashToken(newTokenPlaintext)
        await tx.apiToken.create({
          data: {
            name: 'LLM-API',
            token: hashed,
            displayToken: newTokenPlaintext,
            userId: user.id,
          },
        })
      }
    })

    const newBalance = user.creditBalance + credits

    console.log(`[Admin/Recharge] ✅ ${admin.email}(${admin.authType}) 给 ${user.email}(${user.phone || '无手机'}) 充值 ${credits} 积分${newTokenPlaintext ? ' + 自动生成Token' : ''}`)

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      creditsAdded: credits,
      newBalance,
      tokenGenerated: !!newTokenPlaintext,
      // 明文 token 只在自动生成时返回一次
      newToken: newTokenPlaintext || undefined,
      message: `已给 ${user.name || user.email} 充值 ${credits} 积分${newTokenPlaintext ? '，并自动生成了 API Token' : ''}`,
    })
  } catch (error) {
    console.error('[Admin/Recharge] 失败:', error)
    return NextResponse.json({ error: '充值失败' }, { status: 500 })
  }
}

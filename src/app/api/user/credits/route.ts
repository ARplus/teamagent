/**
 * 用户 Token 余额 + 近期用量
 * GET /api/user/credits
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
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

    // 近期用量（最近 20 条）
    const recentUsage = await prisma.llmUsageLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        model: true,
        totalTokens: true,
        creditsDeducted: true,
        requestSource: true,
        createdAt: true,
      },
    })

    // 累计消耗
    const totalStats = await prisma.llmUsageLog.aggregate({
      where: { userId: user.id },
      _sum: {
        creditsDeducted: true,
        totalTokens: true,
      },
      _count: true,
    })

    return NextResponse.json({
      balance: user.creditBalance,
      totalUsed: totalStats._sum.creditsDeducted || 0,
      totalTokens: totalStats._sum.totalTokens || 0,
      totalCalls: totalStats._count || 0,
      recentUsage,
    })
  } catch (error) {
    console.error('[User/Credits] 失败:', error)
    return NextResponse.json({ error: '获取 Token 信息失败' }, { status: 500 })
  }
}

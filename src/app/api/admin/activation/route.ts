/**
 * 管理员：列出所有激活码
 * GET /api/admin/activation
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAdmin } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  try {
    const admin = await authenticateAdmin(req)
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const codes = await prisma.activationCode.findMany({
      include: {
        usedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // 统计
    const total = codes.length
    const used = codes.filter(c => c.usedAt).length
    const expired = codes.filter(c => !c.usedAt && c.expiresAt < new Date()).length
    const available = total - used - expired

    return NextResponse.json({
      codes,
      stats: { total, used, expired, available },
    })
  } catch (error) {
    console.error('[Admin/Activation/List] 失败:', error)
    return NextResponse.json({ error: '获取激活码列表失败' }, { status: 500 })
  }
}

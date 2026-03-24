/**
 * 管理员：批量生成激活码
 * POST /api/admin/activation/generate
 * Body: { count: 5, credits: 1000, expiresInDays: 90, note?: "微信付款 ¥99" }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateActivationCode } from '@/lib/llm-proxy'
import { authenticateAdmin } from '@/lib/admin-auth'

export async function POST(req: NextRequest) {
  try {
    const admin = await authenticateAdmin(req)
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const {
      count = 1,
      credits = 1000,
      expiresInDays = 90,
      note = '',
    } = body

    // 校验
    if (count < 1 || count > 50) {
      return NextResponse.json({ error: '数量范围 1-50' }, { status: 400 })
    }
    if (credits < 1 || credits > 10000) {
      return NextResponse.json({ error: 'Token 范围 1-10000' }, { status: 400 })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    // 生成唯一激活码
    const codes: string[] = []
    const existingCodes = new Set(
      (await prisma.activationCode.findMany({ select: { code: true } })).map(c => c.code)
    )

    for (let i = 0; i < count; i++) {
      let code: string
      let attempts = 0
      do {
        code = generateActivationCode()
        attempts++
      } while ((existingCodes.has(code) || codes.includes(code)) && attempts < 100)

      if (attempts >= 100) {
        return NextResponse.json({ error: '生成唯一码失败，请重试' }, { status: 500 })
      }
      codes.push(code)
    }

    // 批量写入
    await prisma.activationCode.createMany({
      data: codes.map(code => ({
        code,
        credits,
        expiresAt,
        createdByEmail: admin.email,
        note: note || `${credits} Token / ${expiresInDays}天`,
      })),
    })

    console.log(`[Admin/Activation] ✅ ${admin.email}(${admin.authType}) 生成 ${count} 个激活码 (${credits} Token, ${expiresInDays}天)`)

    return NextResponse.json({
      success: true,
      count,
      credits,
      expiresAt: expiresAt.toISOString(),
      codes,
      message: `成功生成 ${count} 个激活码`,
    })
  } catch (error) {
    console.error('[Admin/Activation/Generate] 失败:', error)
    return NextResponse.json({ error: '生成激活码失败' }, { status: 500 })
  }
}

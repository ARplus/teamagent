import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateToken, hashToken } from '@/lib/api-auth'

// GET /api/tokens - 获取用户的所有 token
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const tokens = await prisma.apiToken.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true
        // 注意：不返回 token 本身
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ tokens })
  } catch (error) {
    console.error('获取 token 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

// POST /api/tokens - 创建新 token
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const { name, expiresInDays } = await req.json()

    // 生成 token
    const rawToken = generateToken()
    const hashedToken = hashToken(rawToken)

    // 计算过期时间
    let expiresAt: Date | null = null
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + expiresInDays)
    }

    // 创建 token
    const apiToken = await prisma.apiToken.create({
      data: {
        token: hashedToken,
        name: name || 'API Token',
        expiresAt,
        userId: user.id
      }
    })

    // 只在创建时返回原始 token，之后无法再获取
    return NextResponse.json({
      message: 'Token 创建成功',
      token: rawToken,  // ⚠️ 只返回一次！
      id: apiToken.id,
      name: apiToken.name,
      expiresAt: apiToken.expiresAt
    })
  } catch (error) {
    console.error('创建 token 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

// DELETE /api/tokens - 删除 token (by id in body)
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const { id } = await req.json()

    // 确保只能删除自己的 token
    const deleted = await prisma.apiToken.deleteMany({
      where: {
        id,
        userId: user.id
      }
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Token 不存在' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Token 已删除' })
  } catch (error) {
    console.error('删除 token 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

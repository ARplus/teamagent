import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

async function getUserId(req: NextRequest): Promise<string | null> {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return tokenAuth.user.id
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    return user?.id || null
  }
  return null
}

/**
 * POST /api/academy/courses/[id]/like — 切换点赞
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: templateId } = await params

    const existing = await prisma.courseLike.findUnique({
      where: { userId_templateId: { userId, templateId } },
    })

    if (existing) {
      await prisma.courseLike.delete({ where: { id: existing.id } })
    } else {
      await prisma.courseLike.create({ data: { userId, templateId } })
    }

    const likeCount = await prisma.courseLike.count({ where: { templateId } })

    return NextResponse.json({ liked: !existing, likeCount })
  } catch (error) {
    console.error('[Academy/Like] 失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}

/**
 * GET /api/academy/courses/[id]/like — 查询点赞状态
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templateId } = await params
    const userId = await getUserId(req)

    const likeCount = await prisma.courseLike.count({ where: { templateId } })
    let liked = false
    if (userId) {
      const existing = await prisma.courseLike.findUnique({
        where: { userId_templateId: { userId, templateId } },
      })
      liked = !!existing
    }

    return NextResponse.json({ liked, likeCount })
  } catch (error) {
    console.error('[Academy/Like/GET] 失败:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}

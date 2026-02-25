import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get('limit') || '50')

    // 取“最近 N 条”，再反转为时间正序返回给前端
    const recentMessages = await prisma.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    const messages = recentMessages.reverse()

    return NextResponse.json({
      messages: messages
        .filter(m => m.content !== '__pending__') // 过滤掉卡住的占位消息
        .map(m => ({
          id: m.id,
          content: m.content,
          role: m.role,
          createdAt: m.createdAt.toISOString(),
          metadata: m.metadata ? JSON.parse(m.metadata) : null,
        })),
    })
  } catch (error) {
    console.error('获取聊天历史失败:', error)
    return NextResponse.json({ error: '获取聊天历史失败' }, { status: 500 })
  }
}

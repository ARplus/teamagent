import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

// GET /api/tasks/[id]/history — 获取任务编辑历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 双重鉴权
    let userId: string | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
    } else {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } })
        userId = user?.id || null
      }
    }

    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 验证任务存在
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, creatorId: true }
    })
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // 查询编辑历史
    const history = await prisma.taskEditHistory.findMany({
      where: { taskId: id },
      include: {
        editor: {
          select: { id: true, name: true, email: true, avatar: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({
      history: history.map(h => ({
        id: h.id,
        editType: h.editType,
        fieldName: h.fieldName,
        oldValue: h.oldValue,
        newValue: h.newValue,
        createdAt: h.createdAt.toISOString(),
        editor: {
          id: h.editor.id,
          name: h.editor.name,
          email: h.editor.email,
          avatar: h.editor.avatar
        }
      }))
    })
  } catch (error) {
    console.error('获取编辑历史失败:', error)
    return NextResponse.json({ error: '获取编辑历史失败' }, { status: 500 })
  }
}

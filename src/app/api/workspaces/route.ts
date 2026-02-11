import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// 获取用户的工作区列表
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const userId = (session.user as any).id

    const workspaces = await prisma.workspace.findMany({
      where: {
        members: {
          some: { userId }
        }
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, avatar: true } }
          }
        },
        _count: { select: { tasks: true } }
      }
    })

    return NextResponse.json(workspaces)

  } catch (error) {
    console.error('获取工作区失败:', error)
    return NextResponse.json({ error: '获取工作区失败' }, { status: 500 })
  }
}

// 创建工作区
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const { name, description } = await req.json()

    if (!name) {
      return NextResponse.json({ error: '工作区名称不能为空' }, { status: 400 })
    }

    const workspace = await prisma.workspace.create({
      data: {
        name,
        description,
        members: {
          create: {
            userId,
            role: 'owner'
          }
        }
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, avatar: true } }
          }
        }
      }
    })

    return NextResponse.json(workspace)

  } catch (error) {
    console.error('创建工作区失败:', error)
    return NextResponse.json({ error: '创建工作区失败' }, { status: 500 })
  }
}

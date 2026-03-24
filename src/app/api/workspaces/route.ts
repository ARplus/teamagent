import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }

  return null
}

// 获取用户的工作区列表
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 用户自己的工作区
    const myWorkspaces = await prisma.workspace.findMany({
      where: {
        members: {
          some: { userId: auth.userId }
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

    // 广场（type: 'plaza'）对所有用户可见，无需加入
    const plazaWorkspaces = await prisma.workspace.findMany({
      where: {
        type: 'plaza',
        id: { notIn: myWorkspaces.map(w => w.id) } // 排除已经在里面的
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

    return NextResponse.json([...myWorkspaces, ...plazaWorkspaces])

  } catch (error) {
    console.error('获取工作区失败:', error)
    return NextResponse.json({ error: '获取工作区失败' }, { status: 500 })
  }
}

// 创建工作区
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

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
            userId: auth.userId,
            role: 'owner'
          }
        },
        channels: {
          create: {
            name: '大厅',
            slug: 'lobby',
            isDefault: true,
            description: '工作区默认频道，所有成员可见',
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

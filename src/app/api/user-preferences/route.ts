import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id }
  }
  return null
}

// GET /api/user-preferences — 获取当前用户的通知偏好
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const pref = await prisma.userPreference.findUnique({
      where: { userId: auth.userId },
    })

    return NextResponse.json({
      preference: pref
        ? {
            dndEnabled: pref.dndEnabled,
            dndStart: pref.dndStart,
            dndEnd: pref.dndEnd,
            minPriority: pref.minPriority,
            callPopupEnabled: pref.callPopupEnabled,
          }
        : {
            // 默认值
            dndEnabled: false,
            dndStart: '22:00',
            dndEnd: '08:00',
            minPriority: 'low',
            callPopupEnabled: true,
          },
    })
  } catch (error) {
    console.error('获取用户偏好失败:', error)
    return NextResponse.json({ error: '获取偏好失败' }, { status: 500 })
  }
}

// PUT /api/user-preferences — 更新通知偏好
export async function PUT(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const body = await req.json()
    const {
      dndEnabled,
      dndStart,
      dndEnd,
      minPriority,
      callPopupEnabled,
    } = body as {
      dndEnabled?: boolean
      dndStart?: string
      dndEnd?: string
      minPriority?: 'urgent' | 'normal' | 'low'
      callPopupEnabled?: boolean
    }

    // 验证时间格式
    const timeRegex = /^\d{2}:\d{2}$/
    if (dndStart && !timeRegex.test(dndStart)) {
      return NextResponse.json({ error: 'dndStart 格式错误，应为 HH:mm' }, { status: 400 })
    }
    if (dndEnd && !timeRegex.test(dndEnd)) {
      return NextResponse.json({ error: 'dndEnd 格式错误，应为 HH:mm' }, { status: 400 })
    }
    if (minPriority && !['urgent', 'normal', 'low'].includes(minPriority)) {
      return NextResponse.json({ error: 'minPriority 必须是 urgent/normal/low' }, { status: 400 })
    }

    const pref = await prisma.userPreference.upsert({
      where: { userId: auth.userId },
      create: {
        userId: auth.userId,
        dndEnabled: dndEnabled ?? false,
        dndStart: dndStart ?? '22:00',
        dndEnd: dndEnd ?? '08:00',
        minPriority: minPriority ?? 'low',
        callPopupEnabled: callPopupEnabled ?? true,
      },
      update: {
        ...(dndEnabled !== undefined && { dndEnabled }),
        ...(dndStart !== undefined && { dndStart }),
        ...(dndEnd !== undefined && { dndEnd }),
        ...(minPriority !== undefined && { minPriority }),
        ...(callPopupEnabled !== undefined && { callPopupEnabled }),
      },
    })

    return NextResponse.json({
      success: true,
      preference: {
        dndEnabled: pref.dndEnabled,
        dndStart: pref.dndStart,
        dndEnd: pref.dndEnd,
        minPriority: pref.minPriority,
        callPopupEnabled: pref.callPopupEnabled,
      },
    })
  } catch (error) {
    console.error('更新用户偏好失败:', error)
    return NextResponse.json({ error: '更新偏好失败' }, { status: 500 })
  }
}

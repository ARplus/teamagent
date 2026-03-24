/**
 * 管理员认证：同时支持 Session（人类网页登录）和 Token（Agent ta_xxx）
 *
 * 用法：
 *   const admin = await authenticateAdmin(req)
 *   if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *   // admin.email 可用于日志
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTokenFromRequest, verifyApiToken } from '@/lib/api-auth'

export const ADMIN_EMAILS = ['aurora@arplus.top', 'muxu@arplus.top', 'yiq.duan@gmail.com', '1009239150@qq.com']

export interface AdminIdentity {
  email: string
  authType: 'session' | 'token'
  userId: string
}

/**
 * 验证请求是否来自 admin（人类 session 或 Agent token 均可）
 * 返回 AdminIdentity 或 null
 */
export async function authenticateAdmin(req?: NextRequest): Promise<AdminIdentity | null> {
  // 方式 1：Session 认证（人类网页登录）
  const session = await getServerSession(authOptions)
  if (session?.user?.email && ADMIN_EMAILS.includes(session.user.email)) {
    return {
      email: session.user.email,
      authType: 'session',
      userId: (session.user as any).id || '',
    }
  }

  // 方式 2：Token 认证（Agent ta_xxx）
  if (req) {
    const token = getTokenFromRequest(req)
    if (token) {
      const user = await verifyApiToken(token)
      if (user?.email && ADMIN_EMAILS.includes(user.email)) {
        return {
          email: user.email,
          authType: 'token',
          userId: user.id,
        }
      }
    }
  }

  return null
}

import { NextRequest } from 'next/server'
import { prisma } from './db'
import crypto from 'crypto'

// 生成 API Token
export function generateToken(): string {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}

// Hash token（存储时用）
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// 从请求中获取 token
export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return null
}

// 验证 API Token，返回用户信息
export async function verifyApiToken(token: string) {
  const hashedToken = hashToken(token)
  
  const apiToken = await prisma.apiToken.findUnique({
    where: { token: hashedToken },
    include: {
      user: {
        include: {
          agent: true
        }
      }
    }
  })

  if (!apiToken) {
    return null
  }

  // 检查是否过期
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
    return null
  }

  // 更新最后使用时间
  await prisma.apiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() }
  })

  return apiToken.user
}

// API 路由中间件：验证 token 或 session
export async function authenticateRequest(req: NextRequest) {
  // 先尝试 API Token
  const token = getTokenFromRequest(req)
  if (token) {
    const user = await verifyApiToken(token)
    if (user) {
      return { user, authType: 'token' as const }
    }
    return null
  }

  // 没有 token，返回 null（需要 session 认证）
  return null
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_IMAGE_SIZE = 10 * 1024 * 1024  // 10MB

/**
 * POST /api/upload/image — 上传图片（封面图等）
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '请选择图片文件' }, { status: 400 })
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({
        error: `不支持的图片格式: ${file.type}，支持 jpg/png/webp/gif`,
      }, { status: 400 })
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({
        error: `图片太大，最大 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
      }, { status: 400 })
    }

    const randomId = crypto.randomBytes(12).toString('hex')
    const ext = path.extname(file.name) || '.jpg'
    const fileName = `${Date.now()}-${randomId}${ext}`

    const relativePath = '/uploads/images'
    const absoluteDir = path.join(process.cwd(), 'public', relativePath)
    const absolutePath = path.join(absoluteDir, fileName)

    if (!existsSync(absoluteDir)) {
      await mkdir(absoluteDir, { recursive: true })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(absolutePath, buffer)

    const fileUrl = `${relativePath}/${fileName}`

    console.log(`[Upload/Image] ${auth.user.name || auth.userId} 上传图片 ${file.name} (${(file.size / 1024).toFixed(0)}KB) -> ${fileUrl}`)

    return NextResponse.json({
      url: fileUrl,
      name: file.name,
      size: file.size,
      type: file.type,
    })
  } catch (error) {
    console.error('[Upload/Image] 失败:', error)
    return NextResponse.json({ error: '图片上传失败' }, { status: 500 })
  }
}

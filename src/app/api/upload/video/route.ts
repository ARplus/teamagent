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

// 允许的视频格式
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

// 最大 200MB
const MAX_VIDEO_SIZE = 200 * 1024 * 1024

/**
 * POST /api/upload/video — 上传视频文件（龙虾学院专用）
 *
 * 请求: multipart/form-data
 *   - file: 视频文件（mp4/webm, max 200MB）
 *
 * 返回:
 * {
 *   url: "/uploads/videos/abc123.mp4",
 *   name: "原始文件名.mp4",
 *   size: 12345678,
 *   type: "video/mp4",
 *   duration: null
 * }
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
      return NextResponse.json({ error: '请选择视频文件' }, { status: 400 })
    }

    // 检查类型
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      return NextResponse.json({
        error: `不支持的视频格式: ${file.type}，支持 mp4/webm`,
      }, { status: 400 })
    }

    // 检查大小
    if (file.size > MAX_VIDEO_SIZE) {
      return NextResponse.json({
        error: `视频太大，最大 ${MAX_VIDEO_SIZE / 1024 / 1024}MB`,
      }, { status: 400 })
    }

    // 生成存储路径
    const randomId = crypto.randomBytes(12).toString('hex')
    const ext = path.extname(file.name) || '.mp4'
    const fileName = `${Date.now()}-${randomId}${ext}`

    const relativePath = '/uploads/videos'
    const absoluteDir = path.join(process.cwd(), 'public', relativePath)
    const absolutePath = path.join(absoluteDir, fileName)

    // 确保目录存在
    if (!existsSync(absoluteDir)) {
      await mkdir(absoluteDir, { recursive: true })
    }

    // 写入文件
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(absolutePath, buffer)

    const fileUrl = `${relativePath}/${fileName}`

    console.log(`[Upload/Video] ${auth.user.name || auth.userId} 上传视频 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) -> ${fileUrl}`)

    return NextResponse.json({
      url: fileUrl,
      name: file.name,
      size: file.size,
      type: file.type,
    })
  } catch (error) {
    console.error('[Upload/Video] 失败:', error)
    return NextResponse.json({ error: '视频上传失败' }, { status: 500 })
  }
}

// Next.js App Router: 允许大文件上传（Route Segment Config）
export const maxDuration = 60

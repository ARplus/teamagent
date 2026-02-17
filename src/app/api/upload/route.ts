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

// 允许的文件类型
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav'
]

// 最大文件大小 (50MB)
const MAX_SIZE = 50 * 1024 * 1024

/**
 * POST /api/upload
 * 
 * 上传文件到服务器
 * 
 * 请求: multipart/form-data
 * - file: 文件
 * 
 * 返回:
 * {
 *   url: "/uploads/2026/02/abc123.png",
 *   name: "原始文件名.png",
 *   size: 12345,
 *   type: "image/png"
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
      return NextResponse.json({ error: '请选择文件' }, { status: 400 })
    }

    // 检查文件类型
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ 
        error: `不支持的文件类型: ${file.type}` 
      }, { status: 400 })
    }

    // 检查文件大小
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ 
        error: `文件太大，最大 ${MAX_SIZE / 1024 / 1024}MB` 
      }, { status: 400 })
    }

    // 生成存储路径: /uploads/YYYY/MM/随机名.扩展名
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const randomId = crypto.randomBytes(8).toString('hex')
    const ext = path.extname(file.name) || getExtFromType(file.type)
    const fileName = `${randomId}${ext}`
    
    const relativePath = `/uploads/${year}/${month}`
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

    console.log(`[Upload] ${auth.user.name || auth.userId} 上传了 ${file.name} -> ${fileUrl}`)

    return NextResponse.json({
      url: fileUrl,
      name: file.name,
      size: file.size,
      type: file.type
    })

  } catch (error) {
    console.error('上传失败:', error)
    return NextResponse.json({ error: '上传失败' }, { status: 500 })
  }
}

// 根据 MIME 类型获取扩展名
function getExtFromType(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3'
  }
  return map[mimeType] || ''
}

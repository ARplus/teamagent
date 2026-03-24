import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

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

const ALLOWED_HTML_TYPES = ['text/html', 'application/xhtml+xml']
const MAX_HTML_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * POST /api/upload/html — 上传 HTML 课件（龙虾学院专用）
 *
 * 请求: multipart/form-data
 *   - file: HTML 文件（.html/.htm，最大 10MB）
 *
 * 返回: { url, name, size, type }
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
      return NextResponse.json({ error: '请选择 HTML 文件' }, { status: 400 })
    }

    // 允许 .html/.htm 扩展名（浏览器有时报 text/plain）
    const ext = path.extname(file.name).toLowerCase()
    const isHtmlExt = ext === '.html' || ext === '.htm'
    const isHtmlType = ALLOWED_HTML_TYPES.includes(file.type) || file.type === 'text/plain'

    if (!isHtmlExt && !isHtmlType) {
      return NextResponse.json({
        error: `不支持的格式: ${file.type}，请上传 .html 或 .htm 文件`,
      }, { status: 400 })
    }

    if (file.size > MAX_HTML_SIZE) {
      return NextResponse.json({
        error: `文件太大，最大 ${MAX_HTML_SIZE / 1024 / 1024}MB`,
      }, { status: 400 })
    }

    const randomId = crypto.randomBytes(12).toString('hex')
    const fileName = `${Date.now()}-${randomId}${ext || '.html'}`

    const relativePath = '/uploads/html'
    const absoluteDir = path.join(process.cwd(), 'public', relativePath)
    const absolutePath = path.join(absoluteDir, fileName)

    if (!existsSync(absoluteDir)) {
      await mkdir(absoluteDir, { recursive: true })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(absolutePath, buffer)

    const fileUrl = `${relativePath}/${fileName}`

    console.log(`[Upload/HTML] ${auth.user.name || auth.userId} 上传 HTML ${file.name} (${(file.size / 1024).toFixed(1)}KB) -> ${fileUrl}`)

    return NextResponse.json({
      url: fileUrl,
      name: file.name,
      size: file.size,
      type: file.type,
    })
  } catch (error) {
    console.error('[Upload/HTML] 失败:', error)
    return NextResponse.json({ error: 'HTML 上传失败' }, { status: 500 })
  }
}

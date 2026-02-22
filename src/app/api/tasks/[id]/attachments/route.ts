import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

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

// 判断是否使用 OSS
function useOSS() {
  return !!(process.env.OSS_ACCESS_KEY_ID && process.env.OSS_BUCKET)
}

// GET /api/tasks/[id]/attachments
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const { id: taskId } = await params
  const attachments = await prisma.attachment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: { uploader: { select: { name: true, email: true } } }
  })
  return NextResponse.json({ attachments })
}

// POST /api/tasks/[id]/attachments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const { id: taskId } = await params
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '没有找到文件' }, { status: 400 })
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: '文件不能超过 20MB' }, { status: 400 })
    }

    const safeName = file.name.replace(/[/\\?%*:|"<>]/g, '-')
    const timestamp = Date.now()
    const filename = `${timestamp}-${safeName}`
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    let fileUrl: string

    if (useOSS()) {
      // ☁️ 生产：上传到阿里云 OSS
      const { ossUpload } = await import('@/lib/oss')
      const ossKey = `tasks/${taskId}/${filename}`
      fileUrl = await ossUpload(ossKey, buffer, file.type || 'application/octet-stream')
      console.log(`[OSS] 上传成功: ${ossKey}`)
    } else {
      // 💾 开发：保存到本地
      const uploadDir = join(process.cwd(), 'uploads', 'tasks', taskId)
      if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
      await writeFile(join(uploadDir, filename), buffer)
      fileUrl = `/api/uploads/tasks/${taskId}/${filename}`
      console.log(`[Local] 保存到: ${uploadDir}/${filename}`)
    }

    const attachment = await prisma.attachment.create({
      data: {
        name: file.name,
        url: fileUrl,
        type: file.type || 'application/octet-stream',
        size: file.size,
        taskId,
        uploaderId: auth.userId,
      },
      include: { uploader: { select: { name: true, email: true } } }
    })

    return NextResponse.json({ success: true, attachment }, { status: 201 })
  } catch (err) {
    console.error('上传失败:', err)
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id]/attachments?attachmentId=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const { id: taskId } = await params
  const attachmentId = req.nextUrl.searchParams.get('attachmentId')
  if (!attachmentId) return NextResponse.json({ error: '缺少 attachmentId' }, { status: 400 })

  const att = await prisma.attachment.findUnique({ where: { id: attachmentId } })
  if (!att || att.taskId !== taskId) return NextResponse.json({ error: '附件不存在' }, { status: 404 })
  if (att.uploaderId !== auth.userId) return NextResponse.json({ error: '无权删除' }, { status: 403 })

  // 同步删除 OSS 上的文件
  if (useOSS() && att.url) {
    try {
      const { ossDelete, ossKeyFromUrl } = await import('@/lib/oss')
      await ossDelete(ossKeyFromUrl(att.url))
    } catch (e) {
      console.warn('[OSS] 删除文件失败（DB 记录仍会删除）:', e)
    }
  }

  await prisma.attachment.delete({ where: { id: attachmentId } })
  return NextResponse.json({ success: true })
}

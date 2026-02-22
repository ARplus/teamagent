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

// GET /api/tasks/[id]/attachments — 获取任务附件列表
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

// POST /api/tasks/[id]/attachments — 上传文件到任务
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const { id: taskId } = await params

  // 确认任务存在
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '没有找到文件' }, { status: 400 })

    // 文件大小限制 20MB
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: '文件不能超过 20MB' }, { status: 400 })
    }

    // 安全文件名：去掉路径符，保留扩展名
    const safeName = file.name.replace(/[/\\?%*:|"<>]/g, '-')
    const timestamp = Date.now()
    const filename = `${timestamp}-${safeName}`

    // 确保目录存在
    const uploadDir = join(process.cwd(), 'uploads', 'tasks', taskId)
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })

    // 写文件
    const bytes = await file.arrayBuffer()
    await writeFile(join(uploadDir, filename), Buffer.from(bytes))

    // 存 DB
    const attachment = await prisma.attachment.create({
      data: {
        name: file.name,
        url: `/api/uploads/tasks/${taskId}/${filename}`,
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
    return NextResponse.json({ error: '上传失败' }, { status: 500 })
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

  await prisma.attachment.delete({ where: { id: attachmentId } })
  return NextResponse.json({ success: true })
}

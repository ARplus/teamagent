import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

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

function useOSS() {
  return !!(process.env.OSS_ACCESS_KEY_ID && process.env.OSS_BUCKET)
}

// GET /api/steps/[id]/files — 步骤级文件列表
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: stepId } = await params

    const step = await prisma.taskStep.findUnique({
      where: { id: stepId },
      select: { id: true, taskId: true, task: { select: { creatorId: true } } }
    })
    if (!step) return NextResponse.json({ error: '步骤不存在' }, { status: 404 })

    // 聚合：直接步骤附件 + 提交附件 + 评论附件
    const attachments = await prisma.attachment.findMany({
      where: {
        OR: [
          { stepId, submissionId: null, commentId: null },
          { submission: { stepId } },
          { comment: { stepId } },
        ]
      },
      include: {
        uploader: {
          select: {
            id: true, name: true, email: true, avatar: true,
            agent: { select: { id: true, name: true } }
          }
        },
        submission: { select: { id: true } },
        comment: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' }
    })

    const files = attachments.map(att => {
      let sourceTag = '步骤附件'
      if (att.submissionId) sourceTag = '步骤产出'
      else if (att.commentId) sourceTag = '评论附件'

      const isAgent = !!att.uploader.agent
      return {
        id: att.id,
        name: att.name,
        url: att.url,
        type: att.type,
        size: att.size,
        createdAt: att.createdAt.toISOString(),
        sourceTag,
        uploader: {
          id: att.uploader.id,
          name: att.uploader.name,
          isAgent,
          agentName: isAgent ? att.uploader.agent!.name : undefined,
        },
        canDelete: att.uploaderId === auth.userId || step.task.creatorId === auth.userId,
      }
    })

    return NextResponse.json({
      files,
      totalCount: files.length,
    })
  } catch (error) {
    console.error('获取步骤文件失败:', error)
    return NextResponse.json({ error: '获取步骤文件失败' }, { status: 500 })
  }
}

// POST /api/steps/[id]/files — 步骤级上传
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: stepId } = await params

    const step = await prisma.taskStep.findUnique({
      where: { id: stepId },
      select: {
        id: true, taskId: true, assigneeId: true,
        task: { select: { creatorId: true, workspaceId: true } }
      }
    })
    if (!step) return NextResponse.json({ error: '步骤不存在' }, { status: 404 })

    // 权限检查
    const userId = auth.userId
    const allowed =
      step.task.creatorId === userId ||
      step.assigneeId === userId

    // 检查 StepAssignee
    let multiAllowed = false
    if (!allowed) {
      const sa = await prisma.stepAssignee.findFirst({
        where: { stepId, userId }
      })
      multiAllowed = !!sa
    }

    // 检查工作区成员
    let wsMemberAllowed = false
    if (!allowed && !multiAllowed) {
      const ws = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: step.task.workspaceId } }
      })
      wsMemberAllowed = !!ws
    }

    if (!allowed && !multiAllowed && !wsMemberAllowed) {
      return NextResponse.json({ error: '无权上传文件到此步骤' }, { status: 403 })
    }

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
      const { ossUpload } = await import('@/lib/oss')
      const ossKey = `steps/${stepId}/${filename}`
      fileUrl = await ossUpload(ossKey, buffer, file.type || 'application/octet-stream')
    } else {
      const uploadDir = join(process.cwd(), 'uploads', 'steps', stepId)
      if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
      await writeFile(join(uploadDir, filename), buffer)
      fileUrl = `/api/uploads/steps/${stepId}/${filename}`
    }

    const attachment = await prisma.attachment.create({
      data: {
        name: file.name,
        url: fileUrl,
        type: file.type || 'application/octet-stream',
        size: file.size,
        stepId,
        uploaderId: auth.userId,
      },
      include: {
        uploader: {
          select: {
            id: true, name: true, email: true, avatar: true,
            agent: { select: { id: true, name: true } }
          }
        }
      }
    })

    const isAgent = !!attachment.uploader.agent
    return NextResponse.json({
      success: true,
      file: {
        id: attachment.id,
        name: attachment.name,
        url: attachment.url,
        type: attachment.type,
        size: attachment.size,
        createdAt: attachment.createdAt.toISOString(),
        sourceTag: '步骤附件',
        uploader: {
          id: attachment.uploader.id,
          name: attachment.uploader.name,
          isAgent,
          agentName: isAgent ? attachment.uploader.agent!.name : undefined,
        },
        canDelete: true,
      }
    }, { status: 201 })
  } catch (error) {
    console.error('上传步骤文件失败:', error)
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 })
  }
}

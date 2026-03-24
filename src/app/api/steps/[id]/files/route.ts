import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// 统一认证（返回 authMethod 用于判断 uploaderType）
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, authMethod: 'token' as const }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, authMethod: 'session' as const }
  }
  return null
}

// V1.1: 检测上传者类型
async function detectUploaderType(userId: string, authMethod: 'token' | 'session'): Promise<'agent' | 'human'> {
  if (authMethod === 'token') {
    const agent = await prisma.agent.findUnique({ where: { userId }, select: { id: true } })
    if (agent) return 'agent'
  }
  return 'human'
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
        // V1.1: 步骤文件只允许上传者本人删除（Agent 不能删人类文件，反之亦然）
        canDelete: att.uploaderId === auth.userId,
        uploaderType: att.uploaderType || (isAgent ? 'agent' : 'human'),
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

    // V1.1: 检测上传者类型
    const uploaderType = await detectUploaderType(auth.userId, auth.authMethod)

    const attachment = await prisma.attachment.create({
      data: {
        name: file.name,
        url: fileUrl,
        type: file.type || 'application/octet-stream',
        size: file.size,
        stepId,
        uploaderId: auth.userId,
        uploaderType,
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

// DELETE /api/steps/[id]/files?fileId=xxx — V1.1: 步骤级文件删除（只允许上传者本人）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: stepId } = await params
    const fileId = req.nextUrl.searchParams.get('fileId')
    if (!fileId) return NextResponse.json({ error: '缺少 fileId' }, { status: 400 })

    const att = await prisma.attachment.findUnique({
      where: { id: fileId },
      select: {
        id: true, uploaderId: true, uploaderType: true, url: true,
        stepId: true,
        submission: { select: { step: { select: { id: true } } } },
        comment: { select: { step: { select: { id: true } } } },
      }
    })
    if (!att) return NextResponse.json({ error: '文件不存在' }, { status: 404 })

    // 验证文件属于此步骤
    const belongsToStep =
      att.stepId === stepId ||
      att.submission?.step?.id === stepId ||
      att.comment?.step?.id === stepId
    if (!belongsToStep) {
      return NextResponse.json({ error: '文件不属于此步骤' }, { status: 404 })
    }

    // V1.1 权限：只允许上传者本人删除（Agent不能删人类文件，人类不能删Agent文件）
    if (att.uploaderId !== auth.userId) {
      return NextResponse.json({ error: '只能删除自己上传的文件' }, { status: 403 })
    }

    // 删除 OSS 文件
    if (useOSS() && att.url) {
      try {
        const { ossDelete, ossKeyFromUrl } = await import('@/lib/oss')
        await ossDelete(ossKeyFromUrl(att.url))
      } catch (e) {
        console.warn('[OSS] 删除文件失败（DB 记录仍会删除）:', e)
      }
    }

    await prisma.attachment.delete({ where: { id: fileId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('删除步骤文件失败:', error)
    return NextResponse.json({ error: '删除文件失败' }, { status: 500 })
  }
}

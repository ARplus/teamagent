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

// sourceTag 推导
function deriveSourceTag(
  att: {
    taskId: string | null
    stepId: string | null
    submissionId: string | null
    commentId: string | null
    createdAt: Date
    submission?: { step: { id: string; order: number; title: string } | null } | null
    comment?: { step: { id: string; order: number; title: string } | null } | null
    step?: { id: string; order: number; title: string } | null
  },
  taskStartedAt: Date | null
): { sourceTag: string; sourceStepId?: string; sourceStepOrder?: number } {
  // 提交附件 → "步骤N产出"
  if (att.submissionId && att.submission?.step) {
    return {
      sourceTag: `步骤${att.submission.step.order}产出`,
      sourceStepId: att.submission.step.id,
      sourceStepOrder: att.submission.step.order,
    }
  }

  // 评论附件
  if (att.commentId && att.comment?.step) {
    return {
      sourceTag: '评论附件',
      sourceStepId: att.comment.step.id,
      sourceStepOrder: att.comment.step.order,
    }
  }

  // 直接步骤附件
  if (att.stepId && att.step && !att.submissionId && !att.commentId) {
    return {
      sourceTag: `步骤${att.step.order}附件`,
      sourceStepId: att.step.id,
      sourceStepOrder: att.step.order,
    }
  }

  // 任务级附件：开始前 → 参考资料，开始后 → 补充
  if (taskStartedAt && att.createdAt > taskStartedAt) {
    return { sourceTag: '补充' }
  }
  return { sourceTag: '参考资料' }
}

// 权限检查：是否可以上传到此任务
async function canUploadToTask(userId: string, taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { creatorId: true, workspaceId: true, assigneeId: true }
  })
  if (!task) return false

  // 1. 任务创建者
  if (task.creatorId === userId) return true

  // 2. 任务执行者
  if (task.assigneeId === userId) return true

  // 3. 工作区成员
  const wsMember = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: task.workspaceId } }
  })
  if (wsMember) return true

  // 4. 步骤 assignee（直接或 StepAssignee 表）
  const stepAssignment = await prisma.taskStep.findFirst({
    where: { taskId, assigneeId: userId }
  })
  if (stepAssignment) return true

  const multiAssignment = await prisma.stepAssignee.findFirst({
    where: { userId, step: { taskId } }
  })
  if (multiAssignment) return true

  return false
}

// GET /api/tasks/[id]/files — 聚合任务全部文件
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: taskId } = await params

    // 验证任务存在
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true, creatorId: true, status: true,
        steps: { select: { startedAt: true }, orderBy: { order: 'asc' } }
      }
    })
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    // 计算任务开始时间：最早的步骤 startedAt
    const taskStartedAt = task.steps
      .map(s => s.startedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] || null

    // 聚合查询：所有来源的附件
    const attachments = await prisma.attachment.findMany({
      where: {
        OR: [
          { taskId },
          { submission: { step: { taskId } } },
          { comment: { step: { taskId } } },
          { stepId: { not: null }, step: { taskId }, submissionId: null, commentId: null },
        ]
      },
      include: {
        uploader: {
          select: {
            id: true, name: true, email: true, avatar: true,
            agent: { select: { id: true, name: true } }
          }
        },
        submission: { select: { step: { select: { id: true, order: true, title: true } } } },
        comment: { select: { step: { select: { id: true, order: true, title: true } } } },
        step: { select: { id: true, order: true, title: true } },
      },
      orderBy: { createdAt: 'desc' }
    })

    const files = attachments.map(att => {
      const { sourceTag, sourceStepId, sourceStepOrder } = deriveSourceTag(att, taskStartedAt)
      const isAgent = !!att.uploader.agent
      return {
        id: att.id,
        name: att.name,
        url: att.url,
        type: att.type,
        size: att.size,
        createdAt: att.createdAt.toISOString(),
        sourceTag,
        sourceStepId,
        sourceStepOrder,
        uploader: {
          id: att.uploader.id,
          name: att.uploader.name,
          isAgent,
          agentName: isAgent ? att.uploader.agent!.name : undefined,
        },
        canDelete: att.uploaderId === auth.userId || task.creatorId === auth.userId,
      }
    })

    const totalSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0)

    return NextResponse.json({
      files,
      totalCount: files.length,
      totalSize,
    })
  } catch (error) {
    console.error('获取任务文件失败:', error)
    return NextResponse.json({ error: '获取任务文件失败' }, { status: 500 })
  }
}

// POST /api/tasks/[id]/files — 上传文件到任务
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: taskId } = await params
    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    // 权限检查
    const allowed = await canUploadToTask(auth.userId, taskId)
    if (!allowed) {
      return NextResponse.json({ error: '无权上传文件到此任务' }, { status: 403 })
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
      const ossKey = `tasks/${taskId}/${filename}`
      fileUrl = await ossUpload(ossKey, buffer, file.type || 'application/octet-stream')
    } else {
      const uploadDir = join(process.cwd(), 'uploads', 'tasks', taskId)
      if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
      await writeFile(join(uploadDir, filename), buffer)
      fileUrl = `/api/uploads/tasks/${taskId}/${filename}`
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
        sourceTag: '参考资料',
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
    console.error('上传文件失败:', error)
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id]/files?fileId=xxx — 删除文件
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: taskId } = await params
    const fileId = req.nextUrl.searchParams.get('fileId')
    if (!fileId) return NextResponse.json({ error: '缺少 fileId' }, { status: 400 })

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { creatorId: true }
    })
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    const att = await prisma.attachment.findUnique({
      where: { id: fileId },
      include: {
        submission: { select: { step: { select: { taskId: true } } } },
        comment: { select: { step: { select: { taskId: true } } } },
        step: { select: { taskId: true } },
      }
    })
    if (!att) return NextResponse.json({ error: '文件不存在' }, { status: 404 })

    // 验证文件属于此任务
    const belongsToTask =
      att.taskId === taskId ||
      att.submission?.step?.taskId === taskId ||
      att.comment?.step?.taskId === taskId ||
      att.step?.taskId === taskId
    if (!belongsToTask) {
      return NextResponse.json({ error: '文件不属于此任务' }, { status: 404 })
    }

    // 权限：上传者 OR 任务创建者
    if (att.uploaderId !== auth.userId && task.creatorId !== auth.userId) {
      return NextResponse.json({ error: '无权删除此文件' }, { status: 403 })
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
    console.error('删除文件失败:', error)
    return NextResponse.json({ error: '删除文件失败' }, { status: 500 })
  }
}

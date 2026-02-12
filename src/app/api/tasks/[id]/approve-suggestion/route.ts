import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseTaskWithAI } from '@/lib/ai-parse'

// POST /api/tasks/[id]/approve-suggestion - 确认建议并自动拆解
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    
    // 需要登录
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 获取建议任务
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { parentTask: true }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (task.status !== 'suggested') {
      return NextResponse.json({ error: '此任务不是建议状态' }, { status: 400 })
    }

    // 更新状态为 todo
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'todo' }
    })

    // 自动 AI 拆解
    let steps: any[] = []
    if (task.description) {
      console.log('自动拆解任务:', task.title)
      const parseResult = await parseTaskWithAI(task.description)
      
      if (parseResult.success && parseResult.steps) {
        // 获取工作区成员
        const workspaceMembers = await prisma.workspaceMember.findMany({
          where: { workspaceId: task.workspaceId },
          include: {
            user: { select: { id: true, name: true, nickname: true } }
          }
        })

        // 创建步骤
        let order = 0
        for (const step of parseResult.steps) {
          order++
          
          // 匹配责任人
          let assigneeId: string | null = null
          const assignees = Array.isArray(step.assignees) ? step.assignees : []
          for (const name of assignees) {
            const member = workspaceMembers.find(m => 
              m.user.nickname === name || m.user.name === name
            )
            if (member) {
              assigneeId = member.user.id
              break
            }
          }

          const created = await prisma.taskStep.create({
            data: {
              title: step.title,
              description: step.description,
              order,
              taskId,
              assigneeId,
              assigneeNames: JSON.stringify(assignees),
              inputs: JSON.stringify(step.inputs || []),
              outputs: JSON.stringify(step.outputs || []),
              skills: JSON.stringify(step.skills || []),
              status: 'pending',
              agentStatus: assigneeId ? 'pending' : null
            }
          })
          steps.push(created)
        }
      }
    }

    // 获取更新后的任务
    const updatedTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        parentTask: { select: { id: true, title: true } }
      }
    })

    return NextResponse.json({
      message: `建议已确认，${steps.length > 0 ? `自动拆解为 ${steps.length} 个步骤` : '请手动添加步骤'}`,
      task: updatedTask
    })

  } catch (error) {
    console.error('确认建议失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}

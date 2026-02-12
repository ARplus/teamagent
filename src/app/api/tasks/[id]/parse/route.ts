import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

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

// 不是人名的常见词
const NOT_NAMES = [
  '创意', '分类', '图片', '链接', '大模型', '接口', '小程序', '首页', '按钮',
  '模版', '报告', '功能', '居家', '护理', '同时', '确定', '要求', '设计',
  '拆解', '讨论', '联系', '参加', '邀约', '开会', '给到', '更新', '集成'
]

// 从文本中提取人名
function extractNames(text: string): string[] {
  const names: string[] = []
  
  // 模式1: "XX + 动词" - 人名在动词前
  // 例如: "小敏设计" → "小敏"
  const pattern1 = /([\u4e00-\u9fa5]{2,3})(拆解|设计|出|找|给到|给|把|集成|联调|提供|上传|放入|更新|要|讨论|确定|联系|开会|参加|邀约)/g
  let m
  while ((m = pattern1.exec(text)) !== null) {
    const name = m[1]
    if (!NOT_NAMES.includes(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  
  // 模式2: "动词 + XX" 或 "给/到/邀约 + XX" - 人名在介词后
  // 例如: "给到段段" → "段段", "邀约Aurora" → "Aurora"
  const pattern2 = /(?:给到|给|找|联系|邀约|带上)([\u4e00-\u9fa5]{2,3}|[A-Za-z]+)/g
  while ((m = pattern2.exec(text)) !== null) {
    const name = m[1]
    if (!NOT_NAMES.includes(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  
  // 模式3: "于主任"、"李院" 这种 "X + 职位" 格式
  const pattern3 = /([\u4e00-\u9fa5])(主任|院长|院|总|经理|师)/g
  while ((m = pattern3.exec(text)) !== null) {
    const name = m[1] + m[2]
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  
  return names
}

// 简单的任务拆解（规则版，后续可接入大模型）
function parseTaskDescription(description: string) {
  const steps: { title: string; description: string; assignees: string[] }[] = []
  
  // 按数字编号拆分 - 支持多种格式
  const lines = description.split(/\n/).filter(l => l.trim())
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // 匹配 "1. xxx" 或 "1、xxx" 或 "1 xxx" 格式
    const match = trimmed.match(/^(\d+)[.、\s]\s*(.+)/)
    if (match) {
      const content = match[2]
      const assignees = extractNames(content)
      
      steps.push({
        title: content.length > 40 ? content.slice(0, 40) + '...' : content,
        description: content,
        assignees
      })
    }
  }
  
  // 如果没有匹配到编号格式，尝试按句子/逗号拆分
  if (steps.length === 0) {
    // 合并所有行
    const fullText = lines.join(' ')
    
    // 按句号、逗号、分号拆分
    const sentences = fullText.split(/[。，；]/).filter(s => s.trim().length > 5)
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (trimmed.length > 0) {
        const assignees = extractNames(trimmed)
        
        steps.push({
          title: trimmed.length > 40 ? trimmed.slice(0, 40) + '...' : trimmed,
          description: trimmed,
          assignees
        })
      }
    }
  }
  
  return steps
}

// POST /api/tasks/[id]/parse - AI 解析任务并创建步骤
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 获取任务
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { steps: true }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (!task.description) {
      return NextResponse.json({ error: '任务没有描述，无法解析' }, { status: 400 })
    }

    // 解析任务描述
    const parsedSteps = parseTaskDescription(task.description)

    if (parsedSteps.length === 0) {
      return NextResponse.json({ error: '无法从描述中识别步骤' }, { status: 400 })
    }

    // 获取工作区内所有用户（用于匹配昵称）
    const workspaceMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: {
          select: { id: true, name: true, nickname: true }
        }
      }
    })

    // 创建步骤
    const createdSteps = []
    let order = task.steps.length // 从现有步骤数量开始

    for (const step of parsedSteps) {
      order++
      
      // 尝试匹配负责人
      let assigneeId: string | null = null
      for (const assigneeName of step.assignees) {
        const member = workspaceMembers.find(m => 
          m.user.nickname === assigneeName || 
          m.user.name === assigneeName
        )
        if (member) {
          assigneeId = member.user.id
          break
        }
      }

      const created = await prisma.taskStep.create({
        data: {
          title: step.title,
          description: `负责人: ${step.assignees.join('、') || '待分配'}\n\n${step.description}`,
          order,
          taskId,
          assigneeId
        },
        include: {
          assignee: { select: { id: true, name: true, nickname: true } }
        }
      })

      createdSteps.push({
        ...created,
        recognizedAssignees: step.assignees
      })
    }

    return NextResponse.json({
      message: `成功创建 ${createdSteps.length} 个步骤`,
      steps: createdSteps
    })

  } catch (error) {
    console.error('解析任务失败:', error)
    return NextResponse.json({ error: '解析任务失败' }, { status: 500 })
  }
}

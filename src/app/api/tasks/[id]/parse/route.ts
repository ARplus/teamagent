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
  '拆解', '讨论', '联系', '参加', '邀约', '开会', '给到', '更新', '集成',
  '分析', '提供', '需要', '完成', '进行', '测试', '检查', '审核'
]

// 从文本中提取人名
function extractNames(text: string): string[] {
  const names: string[] = []
  
  // 模式1: "XX + 动词" - 人名在动词前
  const pattern1 = /([\u4e00-\u9fa5]{2,3})(拆解|设计|出|找|给到|给|把|集成|联调|提供|上传|放入|更新|要|讨论|确定|联系|开会|参加|邀约|负责|完成|检查|审核|测试)/g
  let m
  while ((m = pattern1.exec(text)) !== null) {
    const name = m[1]
    if (!NOT_NAMES.includes(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  
  // 模式2: "给/到/邀约/联系 + XX"
  const pattern2 = /(?:给到|给|找|联系|邀约|带上|通知)([\u4e00-\u9fa5]{2,3}|[A-Za-z]+)/g
  while ((m = pattern2.exec(text)) !== null) {
    const name = m[1]
    if (!NOT_NAMES.includes(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  
  // 模式3: "X主任"、"X院长" 等职位格式
  const pattern3 = /([\u4e00-\u9fa5])(主任|院长|院|总|经理|师|工)/g
  while ((m = pattern3.exec(text)) !== null) {
    const name = m[1] + m[2]
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  
  return names
}

// 推断可能需要的 Skills
function inferSkills(text: string): string[] {
  const skills: string[] = []
  
  if (/设计|模版|UI|界面/.test(text)) skills.push('设计')
  if (/文档|报告|分析|拆解/.test(text)) skills.push('文档处理')
  if (/代码|开发|API|接口/.test(text)) skills.push('代码开发')
  if (/会议|开会|安排|日程/.test(text)) skills.push('日程管理')
  if (/邮件|通知|消息/.test(text)) skills.push('消息发送')
  if (/测试|联调|检查/.test(text)) skills.push('测试')
  if (/上传|OSS|存储/.test(text)) skills.push('文件管理')
  if (/H5|小程序|前端/.test(text)) skills.push('前端开发')
  if (/prompt|AI|大模型/.test(text)) skills.push('AI对接')
  
  return skills
}

// 推断输入输出
function inferInputsOutputs(text: string, prevStep?: string): { inputs: string[], outputs: string[] } {
  const inputs: string[] = []
  const outputs: string[] = []
  
  // 输入：从描述中找 "XX给过来的"、"基于XX" 等
  const inputPatterns = [
    /(?:给过来的|收到的|基于|根据)([\u4e00-\u9fa5]+(?:报告|文档|设计|方案|链接|数据))/g,
    /([\u4e00-\u9fa5]+(?:报告|文档|设计|方案|链接|数据))(?:给到|提供给)/g
  ]
  for (const pattern of inputPatterns) {
    let m
    while ((m = pattern.exec(text)) !== null) {
      if (!inputs.includes(m[1])) inputs.push(m[1])
    }
  }
  
  // 如果有前置步骤，前置步骤的产出就是输入
  if (prevStep) {
    inputs.push(`上一步产出`)
  }
  
  // 输出：从描述中找产出物
  if (/设计.*模版/.test(text)) outputs.push('模版设计')
  if (/prompt/.test(text)) outputs.push('Prompt')
  if (/报告/.test(text) && /拆解|分析/.test(text)) outputs.push('分析结果')
  if (/确定|选择/.test(text)) outputs.push('确认方案')
  if (/会议|开会/.test(text)) outputs.push('会议安排')
  if (/H5/.test(text)) outputs.push('H5页面')
  if (/上传.*OSS/.test(text)) outputs.push('OSS链接')
  if (/集成/.test(text)) outputs.push('集成完成')
  if (/测试|联调/.test(text)) outputs.push('测试通过')
  
  // 默认输出
  if (outputs.length === 0) outputs.push('任务完成')
  
  return { inputs, outputs }
}

// 解析任务描述
function parseTaskDescription(description: string) {
  const steps: {
    title: string
    description: string
    assignees: string[]
    inputs: string[]
    outputs: string[]
    skills: string[]
  }[] = []
  
  const lines = description.split(/\n/).filter(l => l.trim())
  let prevStepTitle = ''
  
  // 先尝试按数字编号拆分
  for (const line of lines) {
    const trimmed = line.trim()
    const match = trimmed.match(/^(\d+)[.、\s]\s*(.+)/)
    
    if (match) {
      const content = match[2]
      const assignees = extractNames(content)
      const skills = inferSkills(content)
      const { inputs, outputs } = inferInputsOutputs(content, prevStepTitle)
      
      steps.push({
        title: content.length > 40 ? content.slice(0, 40) + '...' : content,
        description: content,
        assignees,
        inputs,
        outputs,
        skills
      })
      
      prevStepTitle = content
    }
  }
  
  // 如果没有编号，按句子拆分
  if (steps.length === 0) {
    const fullText = lines.join(' ')
    const sentences = fullText.split(/[。，；]/).filter(s => s.trim().length > 5)
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (trimmed.length > 0) {
        const assignees = extractNames(trimmed)
        const skills = inferSkills(trimmed)
        const { inputs, outputs } = inferInputsOutputs(trimmed, prevStepTitle)
        
        steps.push({
          title: trimmed.length > 40 ? trimmed.slice(0, 40) + '...' : trimmed,
          description: trimmed,
          assignees,
          inputs,
          outputs,
          skills
        })
        
        prevStepTitle = trimmed
      }
    }
  }
  
  return steps
}

// POST /api/tasks/[id]/parse - 解析任务并创建步骤
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
      return NextResponse.json({ error: '无法从描述中识别步骤，请使用数字编号格式（1. 2. 3.）' }, { status: 400 })
    }

    // 获取工作区内所有用户
    const workspaceMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: { select: { id: true, name: true, nickname: true } }
      }
    })

    // 创建步骤
    const createdSteps = []
    let order = task.steps.length

    for (const step of parsedSteps) {
      order++
      
      // 尝试匹配主责任人
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
          description: step.description,
          order,
          taskId,
          assigneeId,
          assigneeNames: JSON.stringify(step.assignees),
          inputs: JSON.stringify(step.inputs),
          outputs: JSON.stringify(step.outputs),
          skills: JSON.stringify(step.skills),
          status: 'pending',
          agentStatus: assigneeId ? 'pending' : null
        },
        include: {
          assignee: { select: { id: true, name: true, nickname: true } }
        }
      })

      createdSteps.push({
        ...created,
        assigneeNames: step.assignees,
        inputs: step.inputs,
        outputs: step.outputs,
        skills: step.skills
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

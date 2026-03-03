import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'
const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * 查找工作区的主 Agent（首席 Review 官）
 * 优先找任务创建者所在 workspace 的主 Agent，fallback 到任意主 Agent
 */
async function findMainAgent(creatorId: string) {
  // 找创建者所在 workspace 的主 Agent
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: creatorId },
    select: { workspaceId: true }
  })

  if (membership) {
    // 找该 workspace 下的主 Agent
    const mainAgentMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: membership.workspaceId },
      include: {
        user: {
          include: {
            agent: { where: { isMainAgent: true } }
          }
        }
      }
    })
    if (mainAgentMember?.user?.agent) {
      return {
        agentId: mainAgentMember.user.agent.id,
        agentName: mainAgentMember.user.agent.name,
        agentUserId: mainAgentMember.user.id,
      }
    }

    // fallback: 找 workspace 下任何有 agent 的成员
    const anyAgentMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: membership.workspaceId },
      include: {
        user: {
          include: { agent: true }
        }
      }
    })
    if (anyAgentMember?.user?.agent) {
      return {
        agentId: anyAgentMember.user.agent.id,
        agentName: anyAgentMember.user.agent.name,
        agentUserId: anyAgentMember.user.id,
      }
    }
  }

  // 全局 fallback：找任意主 Agent
  const globalMain = await prisma.agent.findFirst({
    where: { isMainAgent: true },
    select: { id: true, name: true, userId: true }
  })
  if (globalMain) {
    return { agentId: globalMain.id, agentName: globalMain.name, agentUserId: globalMain.userId }
  }

  return null
}

/**
 * 调用 LLM（优先 Claude → 降级千问）
 */
async function callEvaluateLLM(systemPrompt: string, userMessage: string): Promise<{ content: string; model: string }> {
  // 优先 Claude（30s 超时，评分比聊天更重要所以超时更长）
  if (ANTHROPIC_API_KEY) {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 30_000)
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          temperature: 0.3,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(t))
      if (res.ok) {
        const data = await res.json()
        const text = data.content?.[0]?.text
        if (text) return { content: text, model: 'claude-sonnet' }
      }
      console.warn('[Evaluate] Claude 调用失败，降级到千问')
    } catch (e: any) {
      console.warn('[Evaluate] Claude 异常，降级到千问:', e.name === 'AbortError' ? '超时(30s)' : e.message)
    }
  }

  // 降级千问（120s 超时）
  const ac2 = new AbortController()
  const t2 = setTimeout(() => ac2.abort(), 120_000)
  const res = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen-max-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: ac2.signal,
  }).finally(() => clearTimeout(t2))

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`千问 API 失败 (${res.status}): ${err}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('千问无返回内容')
  return { content: text, model: 'qwen-max' }
}

/**
 * POST /api/tasks/[id]/evaluate — 触发任务评分
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    // 查任务
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: { select: { id: true, name: true, nickname: true } },
        steps: {
          include: {
            assignee: {
              select: {
                id: true, name: true, nickname: true,
                agent: { select: { id: true, name: true, isMainAgent: true } }
              }
            },
            assignees: {
              include: {
                user: {
                  select: {
                    id: true, name: true, nickname: true,
                    agent: { select: { id: true, name: true } }
                  }
                }
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        evaluations: true,
      }
    })

    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    // 检查权限：只有任务创建者可触发评分
    if (task.creatorId !== user.id) {
      return NextResponse.json({ error: '只有任务创建者可以触发评分' }, { status: 403 })
    }

    // 检查是否已评分
    if (task.evaluations.length > 0) {
      return NextResponse.json({ error: '该任务已评分', evaluations: task.evaluations }, { status: 409 })
    }

    // 检查任务是否完成（所有步骤 done 或 skipped）
    const allDone = task.steps.length > 0 && task.steps.every(s => s.status === 'done' || s.status === 'skipped')
    if (!allDone) {
      return NextResponse.json({ error: '任务尚未完成，所有步骤需为 done 状态' }, { status: 400 })
    }

    // 收集成员信息
    const memberMap = new Map<string, {
      userId: string
      name: string
      type: 'agent' | 'human'
      stepsTotal: number
      stepsDone: number
      totalDurationMs: number
      stepDetails: string[]
    }>()

    for (const step of task.steps) {
      // 收集所有参与者（assignee + assignees）
      const participants: { userId: string; name: string; type: 'agent' | 'human' }[] = []

      if (step.assignee) {
        participants.push({
          userId: step.assignee.id,
          name: step.assignee.agent?.name || step.assignee.nickname || step.assignee.name || '未知',
          type: step.assignee.agent ? 'agent' : 'human'
        })
      }
      for (const sa of step.assignees) {
        if (!participants.some(p => p.userId === sa.userId)) {
          participants.push({
            userId: sa.userId,
            name: sa.user?.agent?.name || sa.user?.nickname || sa.user?.name || '未知',
            type: sa.assigneeType === 'human' ? 'human' : 'agent'
          })
        }
      }

      for (const p of participants) {
        const existing = memberMap.get(p.userId)
        const isDone = step.status === 'done'
        const dur = (step.agentDurationMs || 0) + (step.humanDurationMs || 0)
        const detail = `[${isDone ? '✅' : '⏭'}] ${step.title}${step.rejectionCount ? ` (打回${step.rejectionCount}次)` : ''}${dur > 0 ? ` ${Math.round(dur / 1000)}s` : ''}`

        if (existing) {
          existing.stepsTotal++
          if (isDone) existing.stepsDone++
          existing.totalDurationMs += dur
          existing.stepDetails.push(detail)
        } else {
          memberMap.set(p.userId, {
            userId: p.userId,
            name: p.name,
            type: p.type,
            stepsTotal: 1,
            stepsDone: isDone ? 1 : 0,
            totalDurationMs: dur,
            stepDetails: [detail]
          })
        }
      }
    }

    const members = Array.from(memberMap.values())
    if (members.length === 0) {
      return NextResponse.json({ error: '没有可评分的成员' }, { status: 400 })
    }

    // 查找主 Agent（首席 Review 官）
    const mainAgent = await findMainAgent(task.creatorId)
    const reviewerName = mainAgent?.agentName || 'TeamAgent 评分系统'
    const reviewerId = mainAgent?.agentUserId || user.id

    console.log(`[Evaluate] 评审官: ${reviewerName}${mainAgent ? ` (Agent ID: ${mainAgent.agentId})` : ' (系统默认)'}`)

    // 构建 LLM prompt — 以主 Agent 身份评分
    const systemPrompt = `你是「${reviewerName}」，TeamAgent 军团的首席 Review 官，负责在任务完成后为每位参与成员打分。

## 评分维度（1-5 分，支持 0.5 步进）
- quality（质量分）：产出质量、准确性、完整度
- efficiency（效率分）：是否按时完成、有无拖延
- collaboration（协作分）：沟通配合、主动性

## 综合分计算
overallScore = quality * 0.4 + efficiency * 0.3 + collaboration * 0.3

## 输出格式（JSON 数组）
[
  {
    "userId": "xxx",
    "quality": 4.5,
    "efficiency": 4.0,
    "collaboration": 4.5,
    "comment": "一句话中文点评"
  }
]

## 评分参考
- 被打回次数多 → 质量分降低
- 步骤耗时过长 → 效率分降低
- 步骤完成率低 → 整体偏低
- 参与并行协作 → 协作分加分

只输出 JSON 数组，不要其他内容。`

    const memberLines = members.map(m => {
      const avg = m.stepsTotal > 0 ? Math.round(m.totalDurationMs / m.stepsTotal / 1000) : 0
      return `${m.type === 'agent' ? '🤖' : '👤'} ${m.name} (userId: ${m.userId})
  完成 ${m.stepsDone}/${m.stepsTotal} 步骤，平均耗时 ${avg}s
  ${m.stepDetails.join('\n  ')}`
    }).join('\n\n')

    const userMessage = `请为以下任务的各参与成员评分：

任务：${task.title}
${task.description ? `描述：${task.description}` : ''}
状态：已完成
总步骤数：${task.steps.length}

## 参与成员及表现
${memberLines}`

    // 通知前端：主 Agent 正在评分
    if (mainAgent) {
      sendToUser(task.creatorId, {
        type: 'task:evaluating',
        taskId,
        title: task.title,
        agentName: reviewerName,
      })
    }

    // 调用 LLM 评分（以主 Agent 身份）
    console.log(`[Evaluate] 开始评分: ${task.title} (${members.length} 成员) by ${reviewerName}`)
    const llmResult = await callEvaluateLLM(systemPrompt, userMessage)
    console.log(`[Evaluate] 使用模型: ${llmResult.model}`)

    // 解析评分结果
    let parsedScores: any[]
    try {
      let raw = llmResult.content.trim()
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const parsed = JSON.parse(raw)
      parsedScores = Array.isArray(parsed) ? parsed : (parsed.evaluations ?? parsed.scores ?? [])
      if (!Array.isArray(parsedScores) || parsedScores.length === 0) throw new Error('空数组')
    } catch {
      console.error('[Evaluate] JSON 解析失败:', llmResult.content.substring(0, 300))
      return NextResponse.json({ error: '评分结果解析失败' }, { status: 500 })
    }

    // 存入数据库
    const evaluations = []
    for (const score of parsedScores) {
      const member = memberMap.get(score.userId)
      if (!member) continue

      const quality = Math.min(5, Math.max(1, Number(score.quality) || 3))
      const efficiency = Math.min(5, Math.max(1, Number(score.efficiency) || 3))
      const collaboration = Math.min(5, Math.max(1, Number(score.collaboration) || 3))
      const overallScore = Math.round((quality * 0.4 + efficiency * 0.3 + collaboration * 0.3) * 10) / 10

      const ev = await prisma.taskEvaluation.create({
        data: {
          taskId,
          memberId: member.userId,
          memberName: member.name,
          memberType: member.type,
          quality,
          efficiency,
          collaboration,
          overallScore,
          comment: score.comment || null,
          stepsTotal: member.stepsTotal,
          stepsDone: member.stepsDone,
          avgDurationMs: member.stepsTotal > 0 ? Math.round(member.totalDurationMs / member.stepsTotal) : null,
          evaluatedBy: reviewerId,
          model: mainAgent ? `${reviewerName} (${llmResult.model})` : llmResult.model,
        }
      })
      evaluations.push(ev)
    }

    // 通知任务创建者：评分完成
    sendToUser(task.creatorId, {
      type: 'task:evaluated',
      taskId,
      title: task.title,
      count: evaluations.length,
      reviewerName,
    })

    console.log(`[Evaluate] ✅ 完成 by ${reviewerName} (${llmResult.model})，${evaluations.length} 成员评分`)

    return NextResponse.json({
      message: `✅ ${reviewerName} 已为 ${evaluations.length} 位成员生成评分`,
      model: llmResult.model,
      reviewer: reviewerName,
      evaluations
    })

  } catch (error) {
    console.error('[Evaluate] 失败:', error)
    return NextResponse.json({
      error: '评分失败',
      detail: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 })
  }
}

/**
 * GET /api/tasks/[id]/evaluate — 获取评分结果
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const evaluations = await prisma.taskEvaluation.findMany({
      where: { taskId },
      orderBy: { overallScore: 'desc' }
    })

    return NextResponse.json({ evaluations })
  } catch (error) {
    console.error('获取评分失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, sendToUsers } from '@/lib/events'
import { getStartableSteps, activateAndNotifySteps } from '@/lib/step-scheduling'
import { parseTaskWithAI } from '@/lib/ai-parse'
import { orchestrateDecompose } from '@/lib/decompose-orchestrator'
import { buildDecomposePrompt, BASE_EXECUTION_RULES } from '@/lib/decompose-prompt'
import { createNotification, notificationTemplates } from '@/lib/notifications'

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

// 获取任务列表
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)

    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    // 只返回与当前用户相关的任务：
    // 1. 我创建的任务（任何 mode）
    // 2. 我是步骤执行人的任务
    // 3. 我是工作区 owner/admin — 仅限 team 任务（Solo 任务对他人完全私密，admin 也看不到）
    // 4. 我通过邀请链接被明确分享的任务（即使没有步骤也能看到）
    //    → 接受邀请时会在 InviteToken 记录 inviteeId，永久保留可见性
    // ⚠️ Solo 任务隐私规则：Solo 任务只有创建者、被分配的步骤执行人、被邀请的人可见
    //   即使是同工作区的 owner/admin 也不能透视他人的 Solo 任务
    const visibilityFilter = {
      OR: [
        // ① 已通过审批门控（或不需要审批）的任务：正常可见性规则
        {
          isApproved: true,
          OR: [
            { creatorId: auth.userId },
            { steps: { some: { assigneeId: auth.userId } } },
            // B08: 多人指派 — 通过 StepAssignee 被分配的任务也可见
            { steps: { some: { assignees: { some: { userId: auth.userId } } } } },
            {
              // admin 透视权：仅限 team 任务，Solo 任务保持创建者私密
              mode: { not: 'solo' },
              workspace: {
                members: { some: { userId: auth.userId, role: { in: ['owner', 'admin'] } } }
              }
            },
            {
              // 通过邀请链接被分享的任务（跨工作区可见性核心）
              invites: { some: { inviteeId: auth.userId, taskId: { not: null } } }
            }
          ]
        },
        // ② 审批门控中（isApproved=false）：仅任务创建者、pre_check 执行人、workspace admin 可见
        {
          isApproved: false,
          OR: [
            { creatorId: auth.userId },
            { steps: { some: { stepType: 'pre_check', assigneeId: auth.userId } } },
            {
              workspace: {
                members: { some: { userId: auth.userId, role: { in: ['owner', 'admin'] } } }
              }
            }
          ]
        }
      ]
    }

    // 排除课程学习任务：① 旧格式 [学习] 前缀 ② 新格式：template.courseType 不为空
    const excludeCourseFilter = {
      NOT: { template: { courseType: { not: null } } },
      title: { not: { startsWith: '[学习]' } },
    }
    const tasks = await prisma.task.findMany({
      where: workspaceId
        ? { workspaceId, ...excludeCourseFilter, ...visibilityFilter }
        : { ...excludeCourseFilter, ...visibilityFilter },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true } } } },
        workspace: { select: { id: true, name: true } },
        steps: {
          select: {
            id: true,
            title: true,
            status: true,
            stepType: true,
            assigneeId: true,
            assignee: { select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true } } } },
            // B08: 多人指派信息 + B11: 任务类型 Icon 需要 assigneeType
            assignees: {
              select: {
                userId: true,
                assigneeType: true,
                status: true,
                user: { select: { id: true, name: true, avatar: true } }
              }
            },
            // V1.1: 未分配步骤高亮
            unassigned: true,
          },
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // V1.1: 附加 unassignedCount
    const tasksWithCounts = tasks.map(t => ({
      ...t,
      unassignedCount: t.steps.filter(s => s.unassigned).length,
    }))

    return NextResponse.json(tasksWithCounts)

  } catch (error) {
    console.error('获取任务失败:', error)
    return NextResponse.json({ error: '获取任务失败' }, { status: 500 })
  }
}

// 创建任务
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const { 
      title, 
      description, 
      status, 
      priority,
      mode,           // solo | team
      dueDate, 
      assigneeId,
      assigneeEmail,  // 支持通过邮箱分配
      workspaceId,
      steps,          // 🆕 Agent 可直接传入步骤数组，跳过 decompose 环节
    } = await req.json()

    const normalizedTitle = (title || '').trim() || (description || '').trim().replace(/\s+/g, ' ').slice(0, 28)

    if (!normalizedTitle) {
      return NextResponse.json(
        { error: '请至少填写标题或任务描述' },
        { status: 400 }
      )
    }

    // 如果没有指定 workspaceId，优先使用用户自己创建的工作区
    let finalWorkspaceId = workspaceId
    if (!finalWorkspaceId) {
      // 优先找 owner 角色的工作区（自己创建的）
      const ownerMembership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId, role: 'owner' },
        select: { workspaceId: true }
      })
      if (ownerMembership) {
        finalWorkspaceId = ownerMembership.workspaceId
      } else {
        // 退而求其次：任意已加入的工作区
        const anyMembership = await prisma.workspaceMember.findFirst({
          where: { userId: auth.userId },
          select: { workspaceId: true }
        })
        if (!anyMembership) {
          return NextResponse.json(
            { error: '请先创建或加入一个工作区' },
            { status: 400 }
          )
        }
        finalWorkspaceId = anyMembership.workspaceId
      }
    }

    // 解析执行者
    let finalAssigneeId = assigneeId
    if (!finalAssigneeId && assigneeEmail) {
      const assignee = await prisma.user.findUnique({
        where: { email: assigneeEmail }
      })
      if (assignee) {
        finalAssigneeId = assignee.id
      }
      // 如果用户不存在，暂时不分配（可以后续发邀请）
    }

    const task = await prisma.task.create({
      data: {
        title: normalizedTitle,
        description,
        status: status || 'todo',
        priority: priority || 'medium',
        mode: mode || 'solo',
        dueDate: dueDate ? new Date(dueDate) : null,
        creatorId: auth.userId,
        assigneeId: finalAssigneeId,
        workspaceId: finalWorkspaceId
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true } } } },
        workspace: { select: { id: true, name: true } }
      }
    })

    // 🆕 Agent 直接传入步骤：立即创建，跳过 decompose
    const prebuiltSteps: any[] = []
    if (Array.isArray(steps) && steps.length > 0) {
      // B6-fix: 预加载工作区成员，用于 assigneeHint → assigneeId 解析
      const wsMembers = await prisma.workspaceMember.findMany({
        where: { workspaceId: finalWorkspaceId },
        include: { user: { select: { id: true, name: true, nickname: true, agent: { select: { name: true } } } } },
      })

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        if (!s.title) continue

        // B6-fix: 如果没有 assigneeId 但有 assigneeHint，解析名字 → userId
        let resolvedAssigneeId = s.assigneeId || null
        let stepUnassigned = false
        let stepUnassignedReason: string | null = null
        // Solo 模式兜底：步骤无 assignee 且无 assigneeHint → 自动分配给创建者（主 Agent）
        if (!resolvedAssigneeId && !s.assigneeHint && (mode === 'solo' || !mode)) {
          resolvedAssigneeId = auth.userId
        }
        if (!resolvedAssigneeId && s.assigneeHint) {
          const hint = s.assigneeHint.trim()
          if (hint) {
            const role = s.assigneeRole // 'human' | 'agent' | 'auto' | undefined
            const matched = wsMembers.find(m => {
              const agentName = (m.user.agent as any)?.name
              const userName = m.user.name
              const userNick = m.user.nickname
              if (role === 'human') {
                if (userName === hint || userNick === hint) return true
                if (userName && (userName.includes(hint) || hint.includes(userName))) return true
                if (userNick && (userNick.includes(hint) || hint.includes(userNick))) return true
                return false
              }
              if (role === 'agent') {
                if (agentName && agentName === hint) return true
                if (agentName && (agentName.includes(hint) || hint.includes(agentName))) return true
                return false
              }
              // auto / 未指定：Agent名 > 用户名/昵称
              if (agentName && agentName === hint) return true
              if (userName === hint || userNick === hint) return true
              if (agentName && (agentName.includes(hint) || hint.includes(agentName))) return true
              if (userName && (userName.includes(hint) || hint.includes(userName))) return true
              return false
            })
            if (matched) {
              resolvedAssigneeId = matched.user.id
            } else {
              stepUnassigned = true
              stepUnassignedReason = `指定「${hint}」但未匹配到工作区成员`
            }
          }
        }

        const createdStep = await prisma.taskStep.create({
          data: {
            title: s.title,
            description: s.description || null,
            order: s.order ?? (i + 1),
            taskId: task.id,
            stepType: s.stepType || 'task',
            assigneeId: resolvedAssigneeId,
            requiresApproval: s.requiresApproval !== false,  // 默认 true
            parallelGroup: s.parallelGroup || null,
            inputs: s.inputs ? JSON.stringify(s.inputs) : null,
            outputs: s.outputs ? JSON.stringify(s.outputs) : null,
            skills: s.skills ? JSON.stringify(s.skills) : null,
            status: 'pending',
            agentStatus: resolvedAssigneeId ? 'pending' : null,
            // B6-fix: 未匹配时标记 unassigned
            unassigned: stepUnassigned || !resolvedAssigneeId,
            unassignedReason: stepUnassignedReason || (!resolvedAssigneeId ? '待分配' : null),
          }
        })
        // B08: 同步创建 StepAssignee 记录
        // P0-1 fix: assigneeRole/assigneeType 明确指定优先，仅 auto 时 auto-detect
        if (resolvedAssigneeId) {
          let detectedType: 'agent' | 'human' = 'agent'
          if (s.assigneeType) {
            detectedType = s.assigneeType  // 明确指定的优先
          } else if (s.assigneeRole === 'human') {
            detectedType = 'human'
          } else if (s.assigneeRole === 'agent') {
            detectedType = 'agent'
          } else {
            const assigneeAgent = await prisma.agent.findUnique({ where: { userId: resolvedAssigneeId }, select: { id: true } })
            if (!assigneeAgent) detectedType = 'human'  // 无 Agent → 纯人类
          }
          await prisma.stepAssignee.create({
            data: { stepId: createdStep.id, userId: resolvedAssigneeId, isPrimary: true, assigneeType: detectedType }
          }).catch(() => {})
        }
        prebuiltSteps.push(createdStep)
      }

      // 通知可以开始的步骤 + 触发 Agent 自动执行
      if (prebuiltSteps.length > 0) {
        const startable = getStartableSteps(prebuiltSteps as any[])
        await activateAndNotifySteps(task.id, startable as any[])
      }
      console.log(`[Task/Create] 直接创建 ${prebuiltSteps.length} 个步骤（跳过 decompose）`)
    }

    // 🔔 发送实时通知
    // 通知创建者（如果在线）
    sendToUser(auth.userId, {
      type: 'task:created',
      taskId: task.id,
      title: task.title
    })

    // 通知被分配者（如果有）
    if (finalAssigneeId && finalAssigneeId !== auth.userId) {
      sendToUser(finalAssigneeId, {
        type: 'task:created',
        taskId: task.id,
        title: task.title
      })
    }

    // 🆕 Solo 模式自动触发拆解：任务创建即通知主 Agent，无需手动点"AI拆解"
    // 如果 Agent 已直接传入步骤，则跳过 decompose
    if (task.mode === 'solo' && task.description && prebuiltSteps.length === 0) {
      try {
        const allMembers = await prisma.workspaceMember.findMany({
          where: { workspaceId: finalWorkspaceId },
          include: {
            user: {
              select: {
                id: true, name: true, nickname: true,
                agent: { select: { id: true, name: true, capabilities: true, isMainAgent: true, parentAgentId: true, soul: true, growthLevel: true, status: true } }
              }
            }
          }
        })
        // Solo: 只用创建者自己的主 Agent，私密任务不能让别人的 Agent 看到内容
        // 优先找 isMainAgent=true 的；若无（数据未标记），fallback 找创建者名下任意 Agent
        const mainMember =
          allMembers.find(m => m.user.id === auth.userId && (m.user.agent as any)?.isMainAgent && !(m.user.agent as any)?.parentAgentId) ??
          allMembers.find(m => m.user.id === auth.userId && !!(m.user.agent as any) && !(m.user.agent as any)?.parentAgentId)

        if (mainMember) {
          const mainAgentUserId = mainMember.user.id
          const mainAgentName = (mainMember.user.agent as any)?.name || '主Agent'
          const mainAgentId = (mainMember.user.agent as any)?.id
          const creatorName = mainMember.user.name || mainMember.user.nickname || '任务创建者'

          const decomposeStep = await prisma.taskStep.create({
            data: {
              title: `📋 拆解任务：${task.title}`,
              description: `请分析任务描述和团队成员性格/能力，将任务拆解为可执行步骤并按【性格匹配】分配给最合适的 Agent。\n\n任务描述：\n${task.description}\n\n👤 任务创建者：${creatorName}。若需要 API Key / 授权 / 人类审批，请分配给人类。\n\n拆解要求：\n1. 拆解为可独立执行的子步骤\n2. 按成员性格/soul 匹配 assignee（填 Agent名字），不强求职责对口\n3. 简单任务无需人类最终审批步骤\n4. 返回 JSON 格式\n\n${BASE_EXECUTION_RULES}`,
              order: 1,
              taskId: task.id,
              stepType: 'decompose',
              assigneeId: mainAgentUserId,
              assigneeNames: mainAgentName,
              requiresApproval: false,
              outputs: JSON.stringify(['steps-json']),
              skills: JSON.stringify(['task-decompose', 'team-management']),
              status: 'pending',
              agentStatus: 'pending',
            }
          })
          await prisma.stepAssignee.create({
            data: { stepId: decomposeStep.id, userId: mainAgentUserId, isPrimary: true, assigneeType: 'agent' }
          }).catch(() => {})
          // 标记任务为等待 Agent 接单（UI 显示"正在赶来"而非"已接单"）
          await prisma.task.update({ where: { id: task.id }, data: { decomposeStatus: 'pending' } })

          // V1.1: 构建填充好的拆解 prompt（含子 Agent 性格信息）
          let decomposePrompt: string | undefined
          try {
            // Solo 模式：包含创建者自己 + 其名下子 Agent（含 soul/personality，Watch 按此分配）
            const teamCtx = allMembers
              .filter(m => {
                const a = m.user.agent as any
                if (m.user.id === auth.userId) return true // 创建者（人类 + 主 Agent）
                // 包含创建者主 Agent 名下的所有子 Agent（按 personality 分配步骤）
                if (a?.parentAgentId && a.parentAgentId === mainAgentId) return true
                return false
              })
              .map(m => {
                const a = m.user.agent as any
                let caps: string[] = []
                try { caps = JSON.parse(a?.capabilities || '[]') } catch {}
                return {
                  name: m.user.name || m.user.nickname || '未知',
                  humanName: m.user.name || m.user.nickname || '未知',
                  isAgent: !!a, agentName: a?.name,
                  capabilities: caps, role: (m as any).role,
                  soulSummary: a?.soul?.substring(0, 200),
                  level: a?.growthLevel || undefined,
                  isSubAgent: !!(a?.parentAgentId),
                  isSubAgentLead: false,
                }
              })
            decomposePrompt = await buildDecomposePrompt(finalWorkspaceId, {
              taskTitle: task.title,
              taskDescription: task.description || '',
              supplement: task.supplement || undefined,
              teamMembers: teamCtx,
            })
          } catch (e) {
            console.warn('[Task/Create] 构建 decomposePrompt 失败，Agent 将使用本地 fallback:', e)
          }

          // 发送 task:decompose-request → 主 Agent（isolated session 拆解，子 Agent 按 personality 分配）
          const agentStatus = (mainMember.user.agent as any)?.status
          const agentOnline = agentStatus === 'online' || agentStatus === 'working'
          // SSE teamMembers 含子 Agent 性格，Watch 按 personality 分配步骤
          const teamCtxForEvent = allMembers
            .filter(m => {
              const a = m.user.agent as any
              if (m.user.id === auth.userId) return true
              if (a?.parentAgentId && a.parentAgentId === mainAgentId) return true
              return false
            })
            .map(m => {
              const a = m.user.agent as any
              let caps: string[] = []
              try { caps = JSON.parse(a?.capabilities || '[]') } catch {}
              return {
                name: m.user.name || m.user.nickname || '未知',
                isAgent: !!a, agentName: a?.name,
                capabilities: caps, role: (m as any).role,
                soulSummary: (a?.soul || '').substring(0, 150),
                isSubAgent: !!(a?.parentAgentId),
              }
            })
          sendToUser(mainAgentUserId, {
            type: 'task:decompose-request',
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description || '',
            mode: 'solo',
            supplement: task.supplement || undefined,
            teamMembers: teamCtxForEvent,
            ...(decomposePrompt ? { decomposePrompt } : {}),
          })
          createNotification({
            userId: mainAgentUserId,
            ...notificationTemplates.stepAssigned(decomposeStep.title, task.title),
            taskId: task.id,
            stepId: decomposeStep.id,
          }).catch(() => {})
          console.log(`[Task/Create] Solo 任务 decompose → 主Agent ${mainAgentName} (${agentStatus})`)

          if (!agentOnline) {
            // Agent 离线时额外通知创建者等待
            sendToUser(auth.userId, {
              type: 'task:waiting-agent',
              taskId: task.id, taskTitle: task.title, agentName: mainAgentName, mode: 'solo' as const,
            })
            createNotification({
              userId: auth.userId,
              ...notificationTemplates.taskWaitingAgent(task.title, mainAgentName),
              taskId: task.id,
            }).catch(() => {})
          }

          // BYOA Solo：3min 后若步骤仍未完成（pending 或 in_progress），再次提醒
          // 注意：decompose步骤创建时就是 in_progress，所以不能只判断 pending
          setTimeout(async () => {
            const st = await prisma.taskStep.findUnique({
              where: { id: decomposeStep.id }, select: { status: true }
            })
            if (st && st.status !== 'done' && st.status !== 'skipped') {
              sendToUser(auth.userId, {
                type: 'task:waiting-agent',
                taskId: task.id, taskTitle: task.title, agentName: mainAgentName, mode: 'solo' as const,
              })
              createNotification({
                userId: auth.userId,
                ...notificationTemplates.taskWaitingAgent(task.title, mainAgentName),
                taskId: task.id,
              }).catch(() => {})
              console.warn(`[Task/Create] Solo 3min 后仍未处理，再次提醒创建者唤醒 Agent`)
            }
          }, 3 * 60 * 1000)
        }
      } catch (e) {
        // 非致命，任务创建不受影响
        console.warn('[Task/Create] 自动 decompose 触发失败:', e)
      }
    }

    // 🆕 Team 模式：BYOA 拆解（主 Agent 优先，3min 广播，5min 超时通知）
    // fire-and-forget，不阻塞任务创建响应
    if (task.mode === 'team' && task.description && prebuiltSteps.length === 0) {
      orchestrateDecompose({
        taskId: task.id,
        title: task.title,
        description: task.description!,
        supplement: task.supplement,
        workspaceId: finalWorkspaceId,
        creatorId: auth.userId,
        mode: 'team',
      }).catch(e => console.warn('[Task/Create] orchestrateDecompose:', e?.message))
    }

    return NextResponse.json({
      ...task,
      steps: prebuiltSteps.length > 0 ? prebuiltSteps : undefined,
    })

  } catch (error) {
    console.error('创建任务失败:', error)
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 })
  }
}

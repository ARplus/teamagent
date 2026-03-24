import { prisma } from './db'

// 通知类型
export type NotificationType =
  | 'task_assigned'      // 任务分配给你
  | 'step_assigned'      // 步骤分配给你
  | 'step_waiting'       // 步骤等待审批
  | 'step_approved'      // 步骤审批通过
  | 'step_rejected'      // 步骤被打回
  | 'step_appealed'      // Agent 提出申诉
  | 'appeal_resolved'    // 申诉已裁定
  | 'task_completed'     // 任务完成
  | 'step_commented'     // 步骤新评论
  | 'mention'            // @提及
  | 'agent_call'         // F06: Agent 主动呼叫
  | 'exam_grading'       // 考试需要批改

// F06: 通知优先级
export type NotificationPriority = 'urgent' | 'normal' | 'low'

// 创建通知
export async function createNotification({
  userId,
  type,
  title,
  content,
  taskId,
  stepId
}: {
  userId: string
  type: NotificationType
  title: string
  content?: string
  taskId?: string
  stepId?: string
}) {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        content,
        taskId,
        stepId
      }
    })
  } catch (error) {
    console.error('创建通知失败:', error)
    return null
  }
}

// 批量创建通知（给多个用户发送相同通知）
export async function createNotifications(
  userIds: string[],
  notification: {
    type: NotificationType
    title: string
    content?: string
    taskId?: string
    stepId?: string
  }
) {
  try {
    return await prisma.notification.createMany({
      data: userIds.map(userId => ({
        userId,
        ...notification
      }))
    })
  } catch (error) {
    console.error('批量创建通知失败:', error)
    return null
  }
}

// 通知模板
export const notificationTemplates = {
  taskAssigned: (taskTitle: string) => ({
    type: 'task_assigned' as NotificationType,
    title: '📋 新任务分配',
    content: `你被分配了任务: ${taskTitle}`
  }),
  
  stepAssigned: (stepTitle: string, taskTitle: string) => ({
    type: 'step_assigned' as NotificationType,
    title: '📝 新步骤分配',
    content: `你被分配了步骤「${stepTitle}」(任务: ${taskTitle})`
  }),
  
  stepWaiting: (stepTitle: string, taskTitle: string, submitterName: string) => ({
    type: 'step_waiting' as NotificationType,
    title: '👀 等待审批',
    content: `${submitterName} 提交了步骤「${stepTitle}」等待你审批 (任务: ${taskTitle})`
  }),
  
  stepApproved: (stepTitle: string, reviewerName: string) => ({
    type: 'step_approved' as NotificationType,
    title: '✅ 审批通过',
    content: `你的步骤「${stepTitle}」已被 ${reviewerName} 通过`
  }),
  
  stepRejected: (stepTitle: string, reviewerName: string, reason?: string) => ({
    type: 'step_rejected' as NotificationType,
    title: '❌ 被打回修改',
    content: `你的步骤「${stepTitle}」被 ${reviewerName} 打回${reason ? `: ${reason}` : ''}`
  }),
  
  taskCompleted: (taskTitle: string) => ({
    type: 'task_completed' as NotificationType,
    title: '🎉 任务完成',
    content: `任务「${taskTitle}」已全部完成！`
  }),

  taskWaitingAgent: (taskTitle: string, agentName: string) => ({
    type: 'task_assigned' as NotificationType,
    title: '⏳ 等待 Agent 响应',
    content: `任务「${taskTitle}」等待 ${agentName} 上线处理，请唤醒 Agent 或手动拆解`
  }),

  taskDecomposeFailed: (taskTitle: string) => ({
    type: 'task_assigned' as NotificationType,
    title: '⚠️ 拆解超时，无人接单',
    content: `任务「${taskTitle}」5 分钟内无 Agent 响应，请手动拆解或检查 Agent 状态`
  }),

  stepAppealed: (stepTitle: string, agentName: string, appealText: string) => ({
    type: 'step_appealed' as NotificationType,
    title: 'Agent提出申诉',
    content: `${agentName} 对步骤「${stepTitle}」提出申诉: ${appealText.slice(0, 100)}`
  }),

  stepCommented: (stepTitle: string, authorName: string) => ({
    type: 'step_commented' as NotificationType,
    title: '💬 新评论',
    content: `${authorName} 在步骤「${stepTitle}」中发表了评论`
  }),

  appealResolved: (stepTitle: string, decision: 'upheld' | 'dismissed') => ({
    type: 'appeal_resolved' as NotificationType,
    title: decision === 'upheld' ? '✅ 申诉成功' : '❌ 申诉驳回',
    content: decision === 'upheld'
      ? `步骤「${stepTitle}」的申诉已被维持，步骤重新进入待审批状态`
      : `步骤「${stepTitle}」的申诉已被驳回，需重新完成`
  }),

  mentioned: (stepTitle: string, authorName: string) => ({
    type: 'mention' as NotificationType,
    title: '📣 有人 @提到了你',
    content: `${authorName} 在步骤「${stepTitle}」的评论中提到了你`
  }),

  // F06: Agent 主动呼叫
  agentCall: (agentName: string, message: string, priority: NotificationPriority = 'normal') => ({
    type: 'agent_call' as NotificationType,
    title: priority === 'urgent' ? `🚨 ${agentName} 紧急呼叫` : `📞 ${agentName} 呼叫你`,
    content: message,
  }),

  // 龙虾学院：课程评论
  courseCommented: (courseName: string, authorName: string) => ({
    type: 'step_commented' as NotificationType,
    title: '💬 课程新评论',
    content: `${authorName} 在课程「${courseName}」中发表了评论`,
  }),
  courseMentioned: (courseName: string, authorName: string) => ({
    type: 'mention' as NotificationType,
    title: '📣 课程评论 @提到了你',
    content: `${authorName} 在课程「${courseName}」的评论中提到了你`,
  }),
}

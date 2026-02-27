/**
 * 用户界面交互 - 通知和对话框
 */

import type { TaskStep, NotificationOptions } from './types'

/**
 * 显示通知
 */
export async function showNotification(options: NotificationOptions): Promise<void> {
  // 这里使用 Claude Code 的 UI API
  // 实际实现需要导入 Claude Code SDK

  console.log(`📢 通知: ${options.title} - ${options.message}`)

  // 示例代码（需要替换为实际的 Claude Code API）
  /*
  await ui.notification({
    title: options.title,
    body: options.message,
    type: options.type || 'info',
    timeout: options.timeout || 5000,
    actions: options.actions?.map(action => ({
      label: action.label,
      onClick: action.callback
    }))
  })
  */
}

/**
 * 通知用户有新的任务步骤
 */
export async function notifyNewStep(step: TaskStep, apiUrl: string): Promise<void> {
  await showNotification({
    title: '🦞 新任务步骤',
    message: `${step.title} - 点击查看详情`,
    type: 'info',
    timeout: 0, // 不自动关闭
    actions: [
      {
        label: '查看任务',
        callback: async () => {
          await openTaskInBrowser(step.taskId, step.id, apiUrl)
        }
      },
      {
        label: '稍后处理',
        callback: () => {
          console.log('用户选择稍后处理')
        }
      }
    ]
  })
}

/**
 * 通知用户步骤需要决策
 */
export async function notifyStepNeedsDecision(step: TaskStep, apiUrl: string): Promise<void> {
  await showNotification({
    title: '⚠️ 需要你的决策',
    message: `${step.title} - 请在 Web 界面处理`,
    type: 'warning',
    timeout: 0,
    actions: [
      {
        label: '打开处理',
        callback: async () => {
          await openTaskInBrowser(step.taskId, step.id, apiUrl)
        }
      }
    ]
  })
}

/**
 * 通知用户步骤执行成功
 */
export async function notifyStepCompleted(step: TaskStep): Promise<void> {
  await showNotification({
    title: '✅ 步骤完成',
    message: step.title,
    type: 'success',
    timeout: 3000
  })
}

/**
 * 通知用户步骤执行失败
 */
export async function notifyStepFailed(step: TaskStep, error: string): Promise<void> {
  await showNotification({
    title: '❌ 步骤执行失败',
    message: `${step.title}\n错误: ${error}`,
    type: 'error',
    timeout: 0,
    actions: [
      {
        label: '查看详情',
        callback: () => {
          console.error('步骤失败:', step.id, error)
        }
      }
    ]
  })
}

/**
 * 在浏览器中打开任务
 */
async function openTaskInBrowser(taskId: string, stepId: string, apiUrl: string): Promise<void> {
  const url = `${apiUrl}/tasks/${taskId}?step=${stepId}`

  console.log(`打开浏览器: ${url}`)

  // 使用 Claude Code API 打开浏览器
  // 实际实现需要导入 Claude Code SDK
  /*
  await ui.openUrl(url)
  */
}

/**
 * 询问用户确认
 */
export async function askConfirmation(message: string): Promise<boolean> {
  console.log(`❓ 询问确认: ${message}`)

  // 示例代码（需要替换为实际的 Claude Code API）
  /*
  const result = await ui.dialog({
    type: 'confirm',
    title: '确认',
    message,
    buttons: [
      { label: '确认', action: 'confirm' },
      { label: '取消', action: 'cancel' }
    ]
  })
  return result.action === 'confirm'
  */

  // 非交互环境无法弹窗，默认同意并记录日志
  console.log(`   ↳ 自动确认（非交互环境）`)
  return true
}

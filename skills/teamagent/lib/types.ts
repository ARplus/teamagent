/**
 * TeamAgent Skill 类型定义
 */

// ============ 配置 ============
export interface SkillConfig {
  apiUrl: string
  apiToken: string
  userId?: string      // 可选，配对流程后不再需要
  agentId?: string     // 注册时保存的 Agent ID
  autoExecute: boolean
  pollingInterval: number
  workDirectory: string
}

// ============ 任务数据结构 ============
export interface TaskStep {
  id: string
  taskId: string
  title: string
  description: string
  order: number

  // 责任人
  assigneeId: string | null
  assigneeNames: string[] | null

  // 输入输出
  inputs: string[] | null
  outputs: string[] | null
  skills: string[] | null

  // 状态
  status: 'pending' | 'in_progress' | 'waiting_approval' | 'done' | 'rejected'
  agentStatus: 'online' | 'pending' | 'working' | 'waiting_approval' | 'blocked' | 'offline' | null

  // 结果
  result: string | null

  // 时间戳
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface Task {
  id: string
  title: string
  description: string | null
  status: 'suggested' | 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate: string | null
  steps?: TaskStep[]
}

// ============ API 响应 ============
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

export interface AvailableStepsResponse {
  steps: TaskStep[]
  count: number
}

export interface TaskSuggestion {
  title: string
  description: string
  reason: string
  priority: string
  assignees: string[]
  skills: string[]
}

// ============ WebSocket 消息 ============
export interface WSMessage {
  type: 'SYNC' | 'NEW_STEP_ASSIGNED' | 'STEP_UPDATED' | 'TASK_APPROVED' | 'TASK_REJECTED' | 'PING' | 'PONG'
  data?: any
}

// ============ 执行结果 ============
export interface ExecuteResult {
  success: boolean
  output?: {
    summary: string
    files?: string[]
    data?: any
  }
  error?: string
}

// ============ 通知选项 ============
export interface NotificationOptions {
  title: string
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  timeout?: number
  actions?: Array<{
    label: string
    callback: () => void | Promise<void>
  }>
}

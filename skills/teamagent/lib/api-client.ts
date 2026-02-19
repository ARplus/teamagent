/**
 * TeamAgent API 客户端
 */

import type { ApiResponse, AvailableStepsResponse, TaskStep, TaskSuggestion, SkillConfig } from './types'

export class TeamAgentClient {
  private config: SkillConfig

  constructor(config: SkillConfig) {
    this.config = config
  }

  // ============ 私有方法 ============

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.apiUrl}/api${endpoint}`

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiToken}`,
          ...options?.headers
        }
      })

      if (!response.ok) {
        const error = await response.text()
        return {
          success: false,
          error: `HTTP ${response.status}: ${error}`
        }
      }

      const data = await response.json()
      return {
        success: true,
        data
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '网络请求失败'
      }
    }
  }

  // ============ 公开 API ============

  /**
   * 获取可领取的步骤
   */
  async getAvailableSteps(): Promise<ApiResponse<AvailableStepsResponse>> {
    return this.request<AvailableStepsResponse>('/my/available-steps')
  }

  /**
   * 领取步骤
   */
  async claimStep(stepId: string): Promise<ApiResponse<{ step: TaskStep }>> {
    return this.request(`/steps/${stepId}/claim`, {
      method: 'POST'
    })
  }

  /**
   * 提交步骤结果
   */
  async submitStep(stepId: string, result: {
    result: string
    outputs?: string[]
    attachments?: Array<{ name: string; url: string }>
  }): Promise<ApiResponse<{ step: TaskStep }>> {
    return this.request(`/steps/${stepId}/submit`, {
      method: 'POST',
      body: JSON.stringify(result)
    })
  }

  /**
   * 批准步骤
   */
  async approveStep(stepId: string): Promise<ApiResponse<{ step: TaskStep }>> {
    return this.request(`/steps/${stepId}/approve`, {
      method: 'POST'
    })
  }

  /**
   * 拒绝步骤
   */
  async rejectStep(stepId: string, reason: string): Promise<ApiResponse<{ step: TaskStep }>> {
    return this.request(`/steps/${stepId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    })
  }

  /**
   * 建议下一步任务
   */
  async suggestNextTask(taskId: string): Promise<ApiResponse<{ suggestion: TaskSuggestion }>> {
    return this.request(`/tasks/${taskId}/suggest-next`, {
      method: 'POST'
    })
  }

  /**
   * 获取 Agent 状态
   */
  async getAgentStatus(): Promise<ApiResponse<{
    status: string
    pendingSteps: number
    inProgressSteps: number
  }>> {
    return this.request('/agent/status')
  }

  /**
   * 更新 Agent 状态
   */
  async updateAgentStatus(status: 'online' | 'working' | 'waiting' | 'offline'): Promise<ApiResponse<any>> {
    return this.request('/agent/status', {
      method: 'PATCH',
      body: JSON.stringify({ status })
    })
  }

  /**
   * 获取我的任务步骤（已分配给我的）
   */
  async getMySteps(status?: string): Promise<ApiResponse<{ steps: TaskStep[] }>> {
    const q = status ? `?status=${status}` : ''
    return this.request<{ steps: TaskStep[] }>(`/my/steps${q}`)
  }

  /**
   * 获取我的任务列表
   */
  async getMyTasks(): Promise<ApiResponse<{ tasks: any[] }>> {
    return this.request<{ tasks: any[] }>('/my/tasks')
  }
}

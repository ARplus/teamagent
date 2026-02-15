/**
 * Agent 工作循环 - 自动领取和执行任务
 */

import type { TaskStep, SkillConfig } from './types'
import { TeamAgentClient } from './api-client'
import { WebSocketClient } from './websocket-client'
import { TaskExecutor } from './executor'
import {
  notifyNewStep,
  notifyStepNeedsDecision,
  notifyStepCompleted,
  notifyStepFailed
} from './ui'

export class AgentWorker {
  private config: SkillConfig
  private apiClient: TeamAgentClient
  private wsClient: WebSocketClient
  private executor: TaskExecutor
  private isRunning = false
  private pollingInterval: any

  constructor(config: SkillConfig) {
    this.config = config
    this.apiClient = new TeamAgentClient(config)
    this.wsClient = new WebSocketClient(config)
    this.executor = new TaskExecutor(config)

    // 设置 WebSocket 事件处理
    this.wsClient.onStepAssigned = (step) => this.handleNewStep(step)
    this.wsClient.onStepUpdated = (step) => this.handleStepUpdate(step)
    this.wsClient.onConnected = () => this.onConnected()
    this.wsClient.onDisconnected = () => this.onDisconnected()
  }

  /**
   * 启动 Agent 工作循环
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Agent 已在运行中')
      return
    }

    this.isRunning = true
    console.log('🦞 TeamAgent Agent 启动中...')

    // 1. 更新 Agent 状态为在线
    await this.apiClient.updateAgentStatus('online')

    // 2. 连接 WebSocket（实时推送）
    await this.wsClient.connect()

    // 3. 启动轮询（备用机制）
    this.startPolling()

    // 4. 首次主动拉取待处理任务
    await this.checkPendingSteps()

    console.log('✅ Agent 已启动')
  }

  /**
   * 停止 Agent 工作循环
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    console.log('停止 Agent...')

    this.isRunning = false

    // 1. 停止轮询
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    // 2. 断开 WebSocket
    this.wsClient.disconnect()

    // 3. 更新状态为离线
    await this.apiClient.updateAgentStatus('offline')

    console.log('Agent 已停止')
  }

  /**
   * 启动定期轮询（备用机制）
   */
  private startPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
    }

    this.pollingInterval = setInterval(
      () => this.checkPendingSteps(),
      this.config.pollingInterval
    )
  }

  /**
   * 检查待处理步骤
   */
  private async checkPendingSteps(): Promise<void> {
    if (!this.isRunning) return

    try {
      const response = await this.apiClient.getAvailableSteps()

      if (!response.success || !response.data) {
        return
      }

      const { steps } = response.data

      if (steps.length === 0) {
        return
      }

      console.log(`发现 ${steps.length} 个可领取的步骤`)

      // 逐个处理步骤
      for (const step of steps) {
        await this.processStep(step)
      }
    } catch (error) {
      console.error('检查待处理步骤失败:', error)
    }
  }

  /**
   * 处理单个步骤
   */
  private async processStep(step: TaskStep): Promise<void> {
    try {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`)
      console.log(`📋 处理步骤: ${step.title}`)
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━\n`)

      // 1. 领取步骤
      console.log('1️⃣ 领取步骤...')
      const claimResponse = await this.apiClient.claimStep(step.id)

      if (!claimResponse.success) {
        console.error(`领取失败: ${claimResponse.error}`)
        return
      }

      console.log('✅ 领取成功')

      // 2. 判断是否可以自动执行
      const canAuto = this.executor.canAutoExecute(step)

      if (canAuto) {
        console.log('2️⃣ 自动执行步骤...')
        await this.autoExecuteStep(step)
      } else {
        console.log('2️⃣ 步骤需要人类决策')
        await this.requestHumanDecision(step)
      }

    } catch (error) {
      console.error(`处理步骤失败:`, error)
      await notifyStepFailed(step, error instanceof Error ? error.message : '未知错误')
    }
  }

  /**
   * 自动执行步骤
   */
  private async autoExecuteStep(step: TaskStep): Promise<void> {
    // 1. 执行步骤
    const result = await this.executor.execute(step)

    if (!result.success) {
      console.error(`❌ 执行失败: ${result.error}`)
      await notifyStepFailed(step, result.error || '执行失败')
      return
    }

    console.log(`✅ 执行成功`)

    // 2. 提交结果
    console.log('3️⃣ 提交结果...')
    const submitResponse = await this.apiClient.submitStep(step.id, {
      result: result.output?.summary || '步骤已完成',
      outputs: result.output?.files,
      attachments: []
    })

    if (!submitResponse.success) {
      console.error(`❌ 提交失败: ${submitResponse.error}`)
      return
    }

    console.log('✅ 提交成功')

    // 3. 通知用户
    await notifyStepCompleted(step)

    // 4. 建议下一步
    if (step.taskId) {
      console.log('4️⃣ 建议下一步任务...')
      const suggestResponse = await this.apiClient.suggestNextTask(step.taskId)

      if (suggestResponse.success && suggestResponse.data) {
        console.log(`💡 建议: ${suggestResponse.data.suggestion.title}`)
      }
    }
  }

  /**
   * 请求人类决策
   */
  private async requestHumanDecision(step: TaskStep): Promise<void> {
    console.log('⚠️  步骤需要人类决策，通知用户...')
    await notifyStepNeedsDecision(step, this.config.apiUrl)
  }

  /**
   * 处理新的步骤分配（WebSocket 事件）
   */
  private async handleNewStep(step: TaskStep): Promise<void> {
    console.log(`\n🔔 收到新步骤通知: ${step.title}`)
    await notifyNewStep(step, this.config.apiUrl)
    await this.processStep(step)
  }

  /**
   * 处理步骤更新（WebSocket 事件）
   */
  private async handleStepUpdate(step: TaskStep): Promise<void> {
    console.log(`🔄 步骤更新: ${step.title} - ${step.status}`)
  }

  /**
   * WebSocket 连接成功
   */
  private async onConnected(): Promise<void> {
    console.log('🔌 WebSocket 已连接，实时推送已启用')
  }

  /**
   * WebSocket 断开连接
   */
  private async onDisconnected(): Promise<void> {
    console.log('🔌 WebSocket 已断开，使用轮询模式')
  }

  /**
   * 获取当前状态
   */
  async getStatus(): Promise<{
    running: boolean
    connected: boolean
    status: any
  }> {
    const statusResponse = await this.apiClient.getAgentStatus()

    return {
      running: this.isRunning,
      connected: this.wsClient.isConnected(),
      status: statusResponse.data || null
    }
  }
}

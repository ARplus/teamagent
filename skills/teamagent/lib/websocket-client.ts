/**
 * WebSocket 客户端 - 实时任务推送
 */

import type { WSMessage, TaskStep, SkillConfig } from './types'

export class WebSocketClient {
  private config: SkillConfig
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 2000
  private isConnecting = false

  // 事件回调
  public onStepAssigned?: (step: TaskStep) => void | Promise<void>
  public onStepUpdated?: (step: TaskStep) => void | Promise<void>
  public onTaskApproved?: (taskId: string) => void | Promise<void>
  public onTaskRejected?: (taskId: string, reason: string) => void | Promise<void>
  public onConnected?: () => void | Promise<void>
  public onDisconnected?: () => void | Promise<void>
  public onError?: (error: Error) => void | Promise<void>

  constructor(config: SkillConfig) {
    this.config = config
  }

  /**
   * 连接到 WebSocket 服务器
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket 已连接或正在连接中')
      return
    }

    this.isConnecting = true

    try {
      const wsUrl = this.config.apiUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://')

      const url = `${wsUrl}/api/agent/stream?userId=${this.config.userId}&token=${this.config.apiToken}`

      console.log(`连接到 WebSocket: ${wsUrl}/api/agent/stream`)

      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log('✅ WebSocket 连接成功')
        this.reconnectAttempts = 0
        this.isConnecting = false
        this.onConnected?.()
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket 错误:', error)
        this.isConnecting = false
        this.onError?.(new Error('WebSocket connection error'))
      }

      this.ws.onclose = () => {
        console.log('WebSocket 连接关闭')
        this.isConnecting = false
        this.onDisconnected?.()
        this.attemptReconnect()
      }

    } catch (error) {
      console.error('WebSocket 连接失败:', error)
      this.isConnecting = false
      this.attemptReconnect()
    }
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessage(data: string) {
    try {
      const message: WSMessage = JSON.parse(data)

      console.log(`收到消息: ${message.type}`)

      switch (message.type) {
        case 'SYNC':
          // 初始同步
          console.log('初始同步完成')
          break

        case 'NEW_STEP_ASSIGNED':
          if (message.data?.step) {
            await this.onStepAssigned?.(message.data.step)
          }
          break

        case 'STEP_UPDATED':
          if (message.data?.step) {
            await this.onStepUpdated?.(message.data.step)
          }
          break

        case 'TASK_APPROVED':
          if (message.data?.taskId) {
            await this.onTaskApproved?.(message.data.taskId)
          }
          break

        case 'TASK_REJECTED':
          if (message.data?.taskId && message.data?.reason) {
            await this.onTaskRejected?.(message.data.taskId, message.data.reason)
          }
          break

        case 'PING':
          // 响应心跳
          this.send({ type: 'PONG' })
          break

        default:
          console.log('未知消息类型:', message.type)
      }
    } catch (error) {
      console.error('处理消息失败:', error)
    }
  }

  /**
   * 发送消息
   */
  private send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  /**
   * 尝试重新连接
   */
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ 达到最大重连次数，停止重连')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    console.log(`⏳ ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`)

    setTimeout(() => {
      this.connect()
    }, delay)
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

/**
 * 统一事件包络 — A2A 协议对齐
 *
 * 为所有 SSE 事件生成标准包络，包含：
 * - eventId: 全局唯一事件标识（用于去重/回放）
 * - eventType: 事件类型（与原始 type 相同）
 * - schemaVersion: 协议版本
 * - traceId: 跨事件追踪链路
 * - correlationId: 关联实体标识（通常是 taskId）
 * - timestamp: ISO 8601 时间戳
 * - producer: 事件生产者
 * - payload: 原始事件数据
 */

import { randomUUID } from 'crypto'

export interface EventEnvelope {
  eventId: string
  eventType: string
  schemaVersion: string
  traceId: string
  correlationId: string | null
  timestamp: string
  producer: string
  payload: Record<string, any>
}

export interface EnvelopeOptions {
  traceId?: string
  correlationId?: string
}

/**
 * 将原始事件包装为标准包络
 * traceId: 由调用方传入或自动生成
 * correlationId: 由调用方传入或从 payload 中提取
 */
export function wrapEnvelope(
  event: Record<string, any>,
  opts?: EnvelopeOptions
): EventEnvelope {
  const { type, ...rest } = event

  return {
    eventId: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    eventType: type || 'unknown',
    schemaVersion: '1.0',
    traceId: opts?.traceId || `tr_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    correlationId: opts?.correlationId || extractCorrelationId(event),
    timestamp: new Date().toISOString(),
    producer: 'teamagent-hub',
    payload: rest,
  }
}

/**
 * 从事件 payload 中自动提取关联 ID
 * 优先级: taskId > stepId > enrollmentId > submissionId > callId > eventId
 */
function extractCorrelationId(event: Record<string, any>): string | null {
  return (
    event.taskId ||
    event.stepId ||
    event.enrollmentId ||
    event.submissionId ||
    event.callId ||
    event.eventId ||
    null
  )
}

/**
 * 将事件编码为双栈 SSE 格式
 * - id: <ISO 时间戳> — 让浏览器 EventSource 自动追踪 Last-Event-ID，断线重连时服务端可 catchup
 * - 行1: event: envelope + data: {完整包络} （新客户端 addEventListener('envelope', ...) 接收）
 * - 行2: data: {原始payload} （老客户端 onmessage 接收，向后兼容）
 */
export function encodeDualStackSSE(
  event: Record<string, any>,
  opts?: EnvelopeOptions
): string {
  const now = new Date().toISOString()

  // ping 事件：只发 id + data，不包络
  if (event.type === 'ping') {
    return `id: ${now}\ndata: ${JSON.stringify(event)}\n\n`
  }

  const envelope = wrapEnvelope(event, opts)
  // id 放在每个块前，让 EventSource 记录最后一次收到的事件时间
  const envelopeLine = `id: ${now}\nevent: envelope\ndata: ${JSON.stringify(envelope)}\n\n`
  const legacyLine = `id: ${now}\ndata: ${JSON.stringify(event)}\n\n`

  return envelopeLine + legacyLine
}

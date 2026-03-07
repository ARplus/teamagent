/**
 * LLM 代理网关工具库
 * 千问 API key 永远不离开服务器，用户通过 ta_xxx token 认证
 */
import crypto from 'crypto'

// ── 模型白名单 ──
export const ALLOWED_MODELS = ['qwen-turbo', 'qwen-max-latest'] as const
export type AllowedModel = (typeof ALLOWED_MODELS)[number]

// ── 积分换算：1 积分 = N token ──
const CREDIT_RATES: Record<string, number> = {
  'qwen-turbo': 1000,         // 便宜模型：1积分/1000token
  'qwen-max-latest': 500,     // 强模型：1积分/500token
}

const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * 根据模型和 token 数量计算需要扣除的积分
 * 最低 1 积分，防止零消耗
 */
export function calculateCredits(model: string, totalTokens: number): number {
  const rate = CREDIT_RATES[model] || 500  // 未知模型按贵的算
  return Math.max(1, Math.ceil(totalTokens / rate))
}

/**
 * 转发请求到千问 API
 */
export async function forwardToQianwen(body: {
  model: string
  messages: any[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  response_format?: any
}): Promise<Response> {
  if (!QWEN_API_KEY) {
    throw new Error('QWEN_API_KEY not configured')
  }

  return fetch(QWEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      ...(body.stream && { stream: true, stream_options: { include_usage: true } }),
      ...(body.temperature !== undefined && { temperature: body.temperature }),
      ...(body.max_tokens !== undefined && { max_tokens: body.max_tokens }),
      ...(body.response_format && { response_format: body.response_format }),
    }),
    signal: AbortSignal.timeout(120_000),
  })
}

/**
 * 生成 8 字符激活码
 * 排除容易混淆的字符：O/0/I/1/L
 */
export function generateActivationCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(8)
  return Array.from(bytes).map((b: number) => chars[b % chars.length]).join('')
}

/**
 * 积分估算：1 积分约等于多少万字
 * qwen-turbo: 1积分=1000token≈750中文字
 */
export function creditsToEstimate(credits: number): string {
  const chars = credits * 750  // 按 turbo 估算
  if (chars >= 10000) {
    return `约 ${(chars / 10000).toFixed(1)} 万字`
  }
  return `约 ${chars} 字`
}

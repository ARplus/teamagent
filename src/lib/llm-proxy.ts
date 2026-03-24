/**
 * LLM 代理网关工具库
 * 上游 API key 永远不离开服务器，用户通过 ta_xxx token 认证
 */
import crypto from 'crypto'

// ── 模型白名单 ──
export const ALLOWED_MODELS = ['kimi-k2.5', 'qwen3.5-flash', 'qwen3-max'] as const
export type AllowedModel = (typeof ALLOWED_MODELS)[number]

// ── 模型路由：哪些模型走 Kimi，哪些走千问 ──
const KIMI_MODELS = new Set(['kimi-k2.5'])

// ── Token 换算：1 Token = N 原始 token ──
const CREDIT_RATES: Record<string, number> = {
  'kimi-k2.5':    2000,   // 强模型：1 Token / 2000 原始token
  'qwen3.5-flash': 10000, // 快模型：1 Token / 10000 原始token
  'qwen3-max':    3000,   // 强模型：1 Token / 3000 原始token
}

const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const KIMI_API_KEY = process.env.KIMI_API_KEY
const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions'

/**
 * 根据模型和原始 token 数量计算需要扣除的 Token 数
 * 最低 1 Token，防止零消耗
 */
export function calculateCredits(model: string, totalTokens: number): number {
  const rate = CREDIT_RATES[model] || 2000
  return Math.max(1, Math.ceil(totalTokens / rate))
}

/**
 * 转发请求到上游 LLM（根据模型自动路由 Kimi / 千问）
 */
export async function forwardToLLM(body: {
  model: string
  messages: any[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  response_format?: any
}): Promise<Response> {
  const isKimi = KIMI_MODELS.has(body.model)

  const apiKey = isKimi ? KIMI_API_KEY : QWEN_API_KEY
  const apiUrl = isKimi ? KIMI_API_URL : QWEN_API_URL

  if (!apiKey) {
    throw new Error(`${isKimi ? 'KIMI_API_KEY' : 'QWEN_API_KEY'} not configured`)
  }

  return fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
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

/** @deprecated 用 forwardToLLM */
export const forwardToQianwen = forwardToLLM

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
 * Token 估算：1 Token ≈ 1 次普通对话
 */
export function creditsToEstimate(credits: number): string {
  if (credits >= 10000) {
    return `约 ${(credits / 10000).toFixed(1)} 万次对话`
  }
  return `约 ${credits} 次对话`
}

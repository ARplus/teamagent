/**
 * LLM 代理网关 — OpenAI 兼容格式
 * POST /api/llm/v1/chat/completions
 *
 * 用户的 OpenClaw 配置:
 *   baseURL: https://agent.avatargaia.top/api/llm/v1
 *   apiKey: ta_xxx
 *   model: kimi-k2.5 / qwen3.5-flash / qwen3-max
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { ALLOWED_MODELS, calculateCredits, forwardToLLM } from '@/lib/llm-proxy'

export async function POST(req: NextRequest) {
  try {
    // 1. Token 认证
    const auth = await authenticateRequest(req)
    if (!auth) {
      return NextResponse.json(
        { error: { message: 'Invalid API key. Use your TeamAgent token (ta_xxx) from Settings page.', type: 'authentication_error' } },
        { status: 401 }
      )
    }
    const userId = auth.user.id

    // 2. 解析请求
    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } },
        { status: 400 }
      )
    }

    const { model, messages, stream, temperature, max_tokens, response_format } = body

    // 3. 校验
    if (!model || !(ALLOWED_MODELS as readonly string[]).includes(model)) {
      return NextResponse.json(
        { error: { message: `Model "${model}" not available. Use: ${ALLOWED_MODELS.join(', ')}`, type: 'invalid_request_error' } },
        { status: 400 }
      )
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: { message: 'messages must be a non-empty array', type: 'invalid_request_error' } },
        { status: 400 }
      )
    }

    // 4. 检查 Token 余额
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    })

    if (!user || user.creditBalance <= 0) {
      return NextResponse.json(
        {
          error: {
            message: 'Token 不足，请在 TeamAgent 设置页兑换激活码充值。Insufficient tokens.',
            type: 'insufficient_credits',
            balance: user?.creditBalance || 0,
          },
        },
        { status: 402 }
      )
    }

    // 5. 转发到千问
    console.log(`[LLM Proxy] ${auth.user.name || userId} → ${model}${stream ? ' [stream]' : ''} (balance: ${user.creditBalance})`)

    const upstream = await forwardToLLM({
      model,
      messages,
      stream: !!stream,
      temperature,
      max_tokens,
      response_format,
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => 'Unknown error')
      console.error(`[LLM Proxy] Upstream error ${upstream.status}:`, errText.slice(0, 200))
      return NextResponse.json(
        { error: { message: 'Upstream LLM error', type: 'upstream_error' } },
        { status: 502 }
      )
    }

    // ── 流式响应 ──
    if (stream) {
      const upstreamBody = upstream.body
      if (!upstreamBody) {
        return NextResponse.json(
          { error: { message: 'No response body from upstream', type: 'upstream_error' } },
          { status: 502 }
        )
      }

      // 用 TransformStream 透传 SSE 并捕获最后的 usage
      let usageData: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

      const transform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk)
          // 尝试从 SSE 数据中提取 usage
          const text = new TextDecoder().decode(chunk)
          const lines = text.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
            try {
              const parsed = JSON.parse(line.slice(6))
              if (parsed.usage) usageData = parsed.usage
            } catch { /* ignore partial JSON */ }
          }
        },
        async flush() {
          // 流结束后异步扣 Token
          if (usageData && usageData.total_tokens > 0) {
            const credits = calculateCredits(model, usageData.total_tokens)
            try {
              await prisma.$transaction([
                prisma.user.update({
                  where: { id: userId },
                  data: { creditBalance: { decrement: credits } },
                }),
                prisma.llmUsageLog.create({
                  data: {
                    userId,
                    model,
                    promptTokens: usageData.prompt_tokens || 0,
                    completionTokens: usageData.completion_tokens || 0,
                    totalTokens: usageData.total_tokens,
                    creditsDeducted: credits,
                    requestSource: req.headers.get('x-request-source') || 'api',
                  },
                }),
              ])
              console.log(`[LLM Proxy] ✅ stream ${model} tokens=${usageData.total_tokens} credits=-${credits}`)
            } catch (e) {
              console.error('[LLM Proxy] 流式扣费失败:', e)
            }
          }
        },
      })

      const readableStream = upstreamBody.pipeThrough(transform)

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // ── 非流式响应 ──
    const data = await upstream.json()

    // 6. 提取 token 用量
    const usage = data.usage || {}
    const totalTokens = usage.total_tokens || 0
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0

    // 7. 计算并扣减 Token（原子操作）
    const credits = calculateCredits(model, totalTokens)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { creditBalance: { decrement: credits } },
      }),
      prisma.llmUsageLog.create({
        data: {
          userId,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          creditsDeducted: credits,
          requestSource: req.headers.get('x-request-source') || 'api',
        },
      }),
    ])

    console.log(`[LLM Proxy] ✅ ${model} tokens=${totalTokens} credits=-${credits} remaining=${user.creditBalance - credits}`)

    // 8. 原样返回千问响应
    return NextResponse.json(data)
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return NextResponse.json(
        { error: { message: 'Request timeout (120s)', type: 'timeout_error' } },
        { status: 504 }
      )
    }
    console.error('[LLM Proxy] 内部错误:', error)
    return NextResponse.json(
      { error: { message: 'Internal server error', type: 'server_error' } },
      { status: 500 }
    )
  }
}

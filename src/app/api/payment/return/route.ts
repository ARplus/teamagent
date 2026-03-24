/**
 * GET /api/payment/return
 * 支付宝同步跳回 — 用户付完款后跳回这里
 * 重定向到设置页显示成功提示
 */
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const outTradeNo = req.nextUrl.searchParams.get('out_trade_no') || ''
  // 跳回首页，带上支付成功标记
  return NextResponse.redirect(
    new URL(`/?payment=success&order=${outTradeNo}`, req.url)
  )
}

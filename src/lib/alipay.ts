/**
 * 支付宝支付封装
 * 电脑网站支付 (alipay.trade.page.pay)
 */
import { AlipaySdk } from 'alipay-sdk'

// 套餐定义（1元 ≈ 10 Token，统一定价）
export const PLANS: Record<string, { name: string; price: number; credits: number; desc: string }> = {
  starter: { name: '体验版', price: 9.9,  credits: 100,  desc: '100 Token · 约100次对话' },
  pro:     { name: '专业版', price: 29.9, credits: 300,  desc: '300 Token · 约300次对话' },
  ultimate:{ name: '尊享版', price: 99,   credits: 1000, desc: '1000 Token · 约1000次对话' },
}

// 初始化 SDK（懒加载单例）
let _sdk: AlipaySdk | null = null

function getAlipaySDK(): AlipaySdk {
  if (_sdk) return _sdk

  const appId = process.env.ALIPAY_APP_ID
  const privateKey = process.env.ALIPAY_PRIVATE_KEY
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error('支付宝配置缺失: ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY')
  }

  _sdk = new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey,
    signType: 'RSA2',
    gateway: 'https://openapi.alipay.com/gateway.do',
  })

  return _sdk
}

/**
 * 创建电脑网站支付订单，返回跳转支付宝的 HTML 表单
 */
export async function createPagePayment(params: {
  outTradeNo: string
  totalAmount: string  // 元，如 "9.90"
  subject: string
  body?: string
}): Promise<string> {
  const sdk = getAlipaySDK()

  const notifyUrl = process.env.ALIPAY_NOTIFY_URL || 'https://agent.avatargaia.top/api/payment/notify'
  const returnUrl = process.env.ALIPAY_RETURN_URL || 'https://agent.avatargaia.top/api/payment/return'

  // pageExecute 返回表单 HTML，前端可直接渲染并自动提交
  const result = sdk.pageExecute('alipay.trade.page.pay', 'POST', {
    bizContent: {
      out_trade_no: params.outTradeNo,
      total_amount: params.totalAmount,
      subject: params.subject,
      body: params.body || '',
      product_code: 'FAST_INSTANT_TRADE_PAY',
    },
    notify_url: notifyUrl,
    return_url: returnUrl,
  })

  return result as string
}

/**
 * 验证支付宝异步通知签名
 */
export function verifyNotifySign(params: Record<string, string>): boolean {
  try {
    const sdk = getAlipaySDK()
    // decoded params + V2 (raw=true)：SDK 不再 decode，直接用传入的值拼签名字符串
    const v2 = sdk.checkNotifySignV2(params)
    if (v2) return true
    // 兜底：再试 V1（SDK 内部会 decode 一次）
    const v1 = sdk.checkNotifySign(params)
    console.log('[Alipay] 验签结果 V2:', v2, 'V1:', v1)
    return v1
  } catch (e) {
    console.error('[Alipay] 验签异常:', e)
    return false
  }
}

/**
 * 生成唯一商户订单号
 */
export function generateOutTradeNo(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 8)
  return `TA_${ts}_${rand}`.toUpperCase()
}

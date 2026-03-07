import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const TOKEN = process.env.WECOM_TOKEN || ''
const ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY || ''
const CORP_ID = process.env.WECOM_CORP_ID || ''

// AES Key = Base64Decode(EncodingAESKey + "=")
function getAesKey() {
  return Buffer.from(ENCODING_AES_KEY + '=', 'base64')
}

function sha1(...args: string[]): string {
  return crypto.createHash('sha1').update(args.sort().join('')).digest('hex')
}

// URLSearchParams 会把 + 解码为空格，但企业微信的 echostr 是 base64 含 +
// 需要从原始 URL 中提取参数
function getRawParam(url: string, name: string): string {
  const match = url.match(new RegExp('[?&]' + name + '=([^&]*)'))
  if (!match) return ''
  // 只解码 %XX，不把 + 当空格
  return decodeURIComponent(match[1].replace(/\+/g, '%2B'))
}

function verifySignature(timestamp: string, nonce: string, encrypted: string, signature: string): boolean {
  return sha1(TOKEN, timestamp, nonce, encrypted) === signature
}

function decrypt(encrypted: string): string {
  const aesKey = getAesKey()
  const iv = aesKey.subarray(0, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
  decipher.setAutoPadding(false)
  let decrypted = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()])
  // 去除 PKCS7 填充
  const pad = decrypted[decrypted.length - 1]
  decrypted = decrypted.subarray(0, decrypted.length - pad)
  // 前16字节随机，4字节消息长度(big-endian)，然后是消息内容，最后是CorpID
  const msgLen = decrypted.readUInt32BE(16)
  return decrypted.subarray(20, 20 + msgLen).toString('utf8')
}

function encrypt(text: string): string {
  const aesKey = getAesKey()
  const iv = aesKey.subarray(0, 16)
  const randomBytes = crypto.randomBytes(16)
  const msgBuffer = Buffer.from(text, 'utf8')
  const msgLenBuffer = Buffer.alloc(4)
  msgLenBuffer.writeUInt32BE(msgBuffer.length, 0)
  const corpIdBuffer = Buffer.from(CORP_ID, 'utf8')
  const totalLen = randomBytes.length + msgLenBuffer.length + msgBuffer.length + corpIdBuffer.length
  const padLen = 32 - (totalLen % 32)
  const padBuffer = Buffer.alloc(padLen, padLen)
  const plaintext = Buffer.concat([randomBytes, msgLenBuffer, msgBuffer, corpIdBuffer, padBuffer])
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64')
}

// GET: 企业微信验证回调URL
export async function GET(req: NextRequest) {
  const rawUrl = req.url
  const msgSignature = getRawParam(rawUrl, 'msg_signature')
  const timestamp = getRawParam(rawUrl, 'timestamp')
  const nonce = getRawParam(rawUrl, 'nonce')
  const echostr = getRawParam(rawUrl, 'echostr')

  console.log('[WeComCallback] GET verify:', { timestamp, nonce, echostrLen: echostr.length })

  if (!TOKEN || !ENCODING_AES_KEY) {
    console.error('[WeComCallback] Missing WECOM_TOKEN or WECOM_ENCODING_AES_KEY env vars')
    return new NextResponse('server config error', { status: 500 })
  }

  // 调试：打印签名计算过程
  const computed = sha1(TOKEN, timestamp, nonce, echostr)
  console.log('[WeComCallback] DEBUG:', {
    tokenLen: TOKEN.length,
    tokenFirst5: TOKEN.substring(0, 5),
    timestamp,
    nonce,
    echostrFirst20: echostr.substring(0, 20),
    echostrLen: echostr.length,
    echostrHasSpace: echostr.includes(' '),
    echostrHasPlus: echostr.includes('+'),
    computed,
    expected: msgSignature,
    match: computed === msgSignature
  })

  if (!verifySignature(timestamp, nonce, echostr, msgSignature)) {
    console.error('[WeComCallback] Signature mismatch')
    return new NextResponse('signature mismatch', { status: 403 })
  }

  const decrypted = decrypt(echostr)
  console.log('[WeComCallback] Verify OK, echostr decrypted')
  return new NextResponse(decrypted)
}

// POST: 接收企业微信消息
export async function POST(req: NextRequest) {
  // 和 GET 一样用 getRawParam，避免 + 被解码为空格
  const rawUrl = req.url
  const msgSignature = getRawParam(rawUrl, 'msg_signature')
  const timestamp = getRawParam(rawUrl, 'timestamp')
  const nonce = getRawParam(rawUrl, 'nonce')

  const body = await req.text()
  console.log('[WeComCallback] POST bodyLen:', body.length, 'preview:', body.substring(0, 200))

  if (!body || body.length < 10) {
    console.error('[WeComCallback] Empty body')
    return new NextResponse('empty body', { status: 400 })
  }

  // 企业微信 API 模式发 JSON: {"encrypt":"..."}
  // 传统模式发 XML: <xml><Encrypt><![CDATA[...]]></Encrypt></xml>
  let encrypted = ''
  if (body.trimStart().startsWith('{')) {
    // JSON 格式
    try {
      const json = JSON.parse(body)
      encrypted = json.encrypt || json.Encrypt || ''
    } catch {
      console.error('[WeComCallback] JSON parse failed:', body.substring(0, 200))
      return new NextResponse('invalid json', { status: 400 })
    }
  } else {
    // XML 格式
    const encryptMatch =
      body.match(/<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/) ||
      body.match(/<Encrypt>([\s\S]*?)<\/Encrypt>/)
    if (encryptMatch) {
      encrypted = encryptMatch[1]
    }
  }

  if (!encrypted) {
    console.error('[WeComCallback] No encrypt found. Body:', body.substring(0, 300))
    return new NextResponse('no encrypt', { status: 400 })
  }
  encrypted = encrypted.trim()

  const computed = sha1(TOKEN, timestamp, nonce, encrypted)
  console.log('[WeComCallback] POST sig:', { computed, expected: msgSignature, match: computed === msgSignature, encLen: encrypted.length })

  if (!verifySignature(timestamp, nonce, encrypted, msgSignature)) {
    return new NextResponse('signature mismatch', { status: 403 })
  }

  const decryptedXml = decrypt(encrypted)
  console.log('[WeComCallback] Decrypted:', decryptedXml.substring(0, 500))
  // 提取消息内容
  const contentMatch = decryptedXml.match(/<Content><!\[CDATA\[([\s\S]*?)\]\]><\/Content>/)
  const fromUserMatch = decryptedXml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/)
  const toUserMatch = decryptedXml.match(/<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/)

  const userMessage = contentMatch ? contentMatch[1] : ''
  const fromUser = fromUserMatch ? fromUserMatch[1] : ''
  const toUser = toUserMatch ? toUserMatch[1] : ''

  console.log(`[WeComCallback] From: ${fromUser}, Message: ${userMessage}`)

  // TODO: 后续对接八爪的处理逻辑（调 LLM 或 OpenClaw）
  const reply = `收到你的消息：${userMessage}\n\n我是八爪🐙，TeamAgent 超级客服，正在学习中，稍后就能帮你干活啦！`

  // 构造回复XML并加密
  const replyXml = `<xml><ToUserName><![CDATA[${fromUser}]]></ToUserName><FromUserName><![CDATA[${toUser}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${reply}]]></Content></xml>`
  const encryptedReply = encrypt(replyXml)
  const replyTimestamp = String(Math.floor(Date.now() / 1000))
  const replyNonce = nonce
  const replySignature = sha1(TOKEN, replyTimestamp, replyNonce, encryptedReply)

  const responseXml = `<xml>
<Encrypt><![CDATA[${encryptedReply}]]></Encrypt>
<MsgSignature><![CDATA[${replySignature}]]></MsgSignature>
<TimeStamp>${replyTimestamp}</TimeStamp>
<Nonce><![CDATA[${replyNonce}]]></Nonce>
</xml>`

  return new NextResponse(responseXml, { headers: { 'Content-Type': 'text/xml' } })
}

/**
 * OpenClaw Gateway 桥接 — 通过本地 Gateway 注入消息到 LLM session
 */
const fs = require('fs')
const path = require('path')
const http = require('http')

const OPENCLAW_CONFIG = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.openclaw', 'openclaw.json'
)

// P0-1 fix: sessionKey 从 Agent 身份动态生成，避免多 Agent 串会话
// 优先级: 环境变量 > config 中的 agentId > 默认值
let _sessionKey = null
function getSessionKey() {
  if (_sessionKey) return _sessionKey
  // 1. 环境变量覆盖（调试/特殊场景）
  if (process.env.TEAMAGENT_CHAT_SESSION_KEY) {
    _sessionKey = process.env.TEAMAGENT_CHAT_SESSION_KEY
    return _sessionKey
  }
  // 2. 从 config.json 读 agentId 动态构建
  try {
    const cfgPath = path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent', 'config.json')
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    if (cfg.agentId) {
      _sessionKey = `agent:${cfg.agentId}:main`
      return _sessionKey
    }
  } catch (_) {}
  // 3. 兜底
  _sessionKey = 'agent:main:main'
  return _sessionKey
}

function getGatewayToken() {
  try {
    const raw = fs.readFileSync(OPENCLAW_CONFIG, 'utf-8')
    try {
      const cfg = JSON.parse(raw)
      if (cfg?.gateway?.auth?.token) return cfg.gateway.auth.token
    } catch (_) {}
    const m = raw.match(/"token"\s*:\s*"([^"]+)"/)
    return m?.[1] || ''
  } catch (_) { return '' }
}

async function checkHealth() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 18789, path: '/health',
      method: 'GET', timeout: 3000
    }, (res) => { res.resume(); resolve(res.statusCode < 500) })
    req.on('error', () => resolve(false))
    req.setTimeout(3000, () => { req.destroy(); resolve(false) })
    req.end()
  })
}

/**
 * 注入消息到 OpenClaw session，返回 LLM 回复文本
 * v15: mode 参数 — 'chat' 保持手机聊天式 framing，'task' 用任务执行 framing
 * @param {string} userMessage
 * @param {string} senderName
 * @param {string} contextId
 * @param {Object} [opts={}]
 * @param {string} [opts.mode='chat'] - 'chat' | 'task'
 */
async function inject(userMessage, senderName, contextId, opts = {}) {
  const { mode = 'chat' } = opts
  const token = getGatewayToken()
  if (!token) throw new Error('Gateway token not found in openclaw config')

  const alive = await checkHealth()
  if (!alive) {
    console.error('   ⚠️  OpenClaw gateway 不可达 (127.0.0.1:18789)')
    throw new Error('OpenClaw gateway unreachable')
  }

  let prompt
  if (mode === 'task') {
    // 任务执行模式 — 不加手机聊天 framing，直接传递结构化指令
    prompt = [
      `[TeamAgent Task Execution]`,
      `[contextId: ${contextId}]`,
      '', userMessage, '',
      '请认真完成任务，直接输出工作成果。中文。',
    ].join('\n')
  } else {
    // 聊天模式 — 保持原有手机聊天式 framing
    prompt = [
      `[TeamAgent Mobile Chat from ${senderName}]`,
      `[msgId: ${contextId}]`,
      '', userMessage, '',
      '请直接回复给手机用户：中文、简洁、自然。',
      '只返回最终回复文本，不要调用任何工具，不要返回 NO_REPLY。',
    ].join('\n')
  }

  const body = JSON.stringify({
    tool: 'sessions_send',
    args: { sessionKey: getSessionKey(), message: prompt, timeoutSeconds: 120 }
  })

  let httpStatus = 0
  const raw = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 18789,
      path: '/tools/invoke', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      httpStatus = res.statusCode
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(130000, () => { req.destroy(); reject(new Error('inject timeout (130s)')) })
    req.write(body)
    req.end()
  })

  console.log(`   🔍 gateway HTTP ${httpStatus} | sessionKey=${getSessionKey()}`)

  if (httpStatus >= 400) {
    throw new Error(`Gateway HTTP ${httpStatus}: ${raw.slice(0, 200)}`)
  }

  return extractReply(raw)
}

/**
 * 从 Gateway 响应中提取回复文本（覆盖各种格式）
 */
function extractReply(raw) {
  let parsed
  try { parsed = JSON.parse(raw) } catch {
    console.error('   ❌ 响应非 JSON:', raw.slice(0, 200))
    return ''
  }

  // Gateway 级别错误
  if (parsed?.ok === false || parsed?.error) {
    const code = parsed?.error?.code || 'UNKNOWN'
    const msg = parsed?.error?.message || parsed?.error || 'unknown'
    throw new Error(`Gateway error [${code}]: ${msg}`)
  }

  if (parsed?.status === 'error' || parsed?.status === 'forbidden') {
    throw new Error(`sessions_send ${parsed.status}: ${parsed.error || parsed.message || ''}`)
  }

  // 解析 inner content
  let inner = null
  const innerText = parsed?.result?.content?.[0]?.text
  if (innerText) {
    try { inner = JSON.parse(innerText) } catch { inner = null }
  }

  // 检测 timeout/error
  if (inner?.status === 'timeout' || inner?.status === 'error' ||
      parsed?.result?.details?.status === 'timeout' || parsed?.status === 'timeout') {
    return ''
  }

  // 多路径提取
  const candidate =
    inner?.reply?.trim?.() ||
    inner?.details?.reply?.trim?.() ||
    parsed?.result?.details?.reply?.trim?.() ||
    parsed?.result?.response?.trim?.() ||
    parsed?.result?.text?.trim?.() ||
    parsed?.result?.reply?.trim?.() ||
    parsed?.response?.trim?.() ||
    parsed?.reply?.trim?.() ||
    parsed?.text?.trim?.() ||
    parsed?.message?.trim?.() ||
    parsed?.result?.message?.trim?.() ||
    parsed?.result?.content?.map?.(c => c.text || '')?.join?.('')?.trim?.() ||
    parsed?.content?.map?.(c => c.text || '')?.join?.('')?.trim?.() ||
    (innerText && !inner ? innerText.trim() : '') ||
    ''

  if (candidate) return candidate

  // 深度递归提取
  const extract = (obj, depth = 0) => {
    if (!obj || depth > 5) return ''
    if (typeof obj === 'string') return obj.trim()
    if (Array.isArray(obj)) return obj.map(i => extract(i, depth + 1)).filter(Boolean).join('\n')
    if (typeof obj === 'object') {
      for (const key of ['text', 'reply', 'response', 'message', 'content', 'result', 'data', 'output']) {
        const v = extract(obj[key], depth + 1)
        if (v && v.length > 2 && !['timeout', 'error', 'NO_REPLY'].includes(v)) return v
      }
    }
    return ''
  }
  return extract(parsed)
}

module.exports = { inject, checkHealth, getGatewayToken }

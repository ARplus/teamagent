/**
 * OpenClaw Gateway 桥接
 *
 * inject() — sessions_send 到主会话（chat 模式，用户消息 / Lobster 本人回复）
 * spawn()  — POST /v1/chat/completions stateless（decompose / step 执行 / 纯计算）
 *
 * v2.5: 新增 spawn()，彻底解决 replyText 拿不到 + 主会话上下文累积问题
 * v2.5.1: ensureTaskExecutorAgent() — Watch 启动时自动创建专用轻量 agent，
 *          失败则降级用 main（方案1+3 组合，用户零感知）
 */
const fs = require('fs')
const path = require('path')
const http = require('http')

const OPENCLAW_CONFIG = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.openclaw', 'openclaw.json'
)

// 专用轻量 task-executor agent（无 skill，无历史）
// 环境变量可覆盖；'none' 表示强制不带 agent header（直接用默认模型）
const TASK_AGENT_ID = process.env.OPENCLAW_TASK_AGENT || 'task-executor'

// task-executor 可用状态缓存（null=未知, true=可用, false=降级到 main）
let _taskAgentAvailable = null

// P0-1 fix: sessionKey 从 Agent 身份动态生成，避免多 Agent 串会话
let _sessionKey = null
function getSessionKey() {
  if (_sessionKey) return _sessionKey
  if (process.env.TEAMAGENT_CHAT_SESSION_KEY) {
    _sessionKey = process.env.TEAMAGENT_CHAT_SESSION_KEY
    return _sessionKey
  }
  try {
    const cfgPath = path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent', 'config.json')
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    if (cfg.agentId) {
      _sessionKey = `agent:${cfg.agentId}:main`
      return _sessionKey
    }
  } catch (_) {}
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

// ─────────────────────────────────────────────────────────
// ensureTaskExecutorAgent() — Watch 启动时调用
// 检查 OpenClaw 是否已有 task-executor agent，没有就自动创建
// 创建失败则降级：spawn() 改用 main agent（功能不变，稍重一点）
// ─────────────────────────────────────────────────────────
async function ensureTaskExecutorAgent() {
  if (_taskAgentAvailable !== null) return _taskAgentAvailable
  if (TASK_AGENT_ID === 'none') { _taskAgentAvailable = false; return false }

  const token = getGatewayToken()
  if (!token) { _taskAgentAvailable = false; return false }

  // 方案一：尝试 PATCH /config 自动创建 task-executor（轻量、无 skill）
  const agentDef = {
    agents: {
      'task-executor': {
        systemPrompt: '你是 TeamAgent 的执行助手。根据任务描述完成工作，只输出 JSON 格式结果，不解释，不添加其他文字。',
        skills: [],
        memory: false,
      }
    }
  }
  const body = JSON.stringify(agentDef)

  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: 18789,
        path: '/config', method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      })
      req.on('error', reject)
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
      req.write(body)
      req.end()
    })

    if (result.status < 300) {
      console.log(`   ✅ [openclaw] task-executor agent 已就绪`)
      _taskAgentAvailable = true
      return true
    }
    // 4xx/5xx — PATCH /config 不支持或字段不对，降级
    console.log(`   ℹ️  [openclaw] task-executor 创建返回 ${result.status}，降级用 main`)
    _taskAgentAvailable = false
    return false
  } catch (e) {
    // 网络错误 / 接口不存在 → 降级，不影响 Watch 启动
    console.log(`   ℹ️  [openclaw] task-executor 自动创建失败(${e.message})，降级用 main`)
    _taskAgentAvailable = false
    return false
  }
}

// ─────────────────────────────────────────────────────────
// spawn() — stateless，POST /v1/chat/completions
// 用于 decompose / step 执行等纯计算场景
// 每次调用全新 session，零历史，直接拿 choices[0].message.content
// ─────────────────────────────────────────────────────────
async function spawn(userPrompt, systemPrompt, opts = {}) {
  const token = getGatewayToken()
  if (!token) throw new Error('Gateway token not found in openclaw config')

  const alive = await checkHealth()
  if (!alive) {
    console.error('   ⚠️  OpenClaw gateway 不可达 (127.0.0.1:18789)')
    throw new Error('OpenClaw gateway unreachable')
  }

  const defaultSystem = '你是 TeamAgent 的执行助手。按照任务描述完成工作，只输出 JSON 格式结果，不解释，不添加任何其他文字。'
  const messages = [
    { role: 'system', content: systemPrompt || defaultSystem },
    { role: 'user', content: userPrompt }
  ]

  const body = JSON.stringify({
    model: 'openclaw',
    messages,
    stream: false,
  })

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(body),
  }

  // task-executor 可用 → 用轻量专用 agent（零 skill，几十 token）
  // 降级 → 不带 agent header（OpenClaw 用默认 main，功能不变，稍重一点）
  if (_taskAgentAvailable === true) {
    headers['x-openclaw-agent-id'] = TASK_AGENT_ID
  } else if (_taskAgentAvailable === null && TASK_AGENT_ID !== 'none') {
    // 未初始化时也带上，让响应告诉我们是否可用
    headers['x-openclaw-agent-id'] = TASK_AGENT_ID
  }
  // _taskAgentAvailable === false → 不加 header，用默认 main

  const timeoutMs = (opts.timeoutSeconds || 180) * 1000

  const raw = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 18789,
      path: '/v1/chat/completions', method: 'POST',
      headers
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`spawn timeout (${opts.timeoutSeconds || 180}s)`)) })
    req.write(body)
    req.end()
  })

  const agentUsed = headers['x-openclaw-agent-id'] || 'default'
  console.log(`   🤖 [spawn] HTTP ${raw.status} | agent=${agentUsed}`)

  // agent not found → 标记降级，无 agent header 重试一次
  if (raw.status === 404 || raw.status === 400) {
    const bodyLower = raw.body.toLowerCase()
    if (bodyLower.includes('agent') && (bodyLower.includes('not found') || bodyLower.includes('unknown'))) {
      if (_taskAgentAvailable !== false) {
        console.log(`   ⚠️  [spawn] task-executor 不存在，降级用 main 重试...`)
        _taskAgentAvailable = false
        // 重试：去掉 agent header
        delete headers['x-openclaw-agent-id']
        headers['Content-Length'] = Buffer.byteLength(body)
        const retry = await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1', port: 18789,
            path: '/v1/chat/completions', method: 'POST', headers
          }, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => resolve({ status: res.statusCode, body: data }))
          })
          req.on('error', reject)
          req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('spawn retry timeout')) })
          req.write(body)
          req.end()
        })
        raw.status = retry.status
        raw.body = retry.body
        console.log(`   🤖 [spawn retry] HTTP ${retry.status} | agent=default`)
      }
    }
  }

  if (raw.status >= 400) {
    throw new Error(`Spawn HTTP ${raw.status}: ${raw.body.slice(0, 200)}`)
  }

  let parsed
  try { parsed = JSON.parse(raw.body) } catch {
    throw new Error(`Spawn response not JSON: ${raw.body.slice(0, 200)}`)
  }

  const content = parsed?.choices?.[0]?.message?.content
  if (!content) throw new Error('Spawn: empty response content')

  return content.trim()
}

// ─────────────────────────────────────────────────────────
// inject() — sessions_send 到主会话（保留，用于 chat:incoming）
// 用户发来的消息需要 Lobster 主会话上下文来回复（记忆、人格等）
// ─────────────────────────────────────────────────────────
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
  if (mode === 'chat') {
    prompt = [
      `[TeamAgent Mobile Chat from ${senderName}]`,
      `[msgId: ${contextId}]`,
      '', userMessage, '',
      '请直接回复给手机用户：中文、简洁、自然。',
      '只返回最终回复文本，不要调用任何工具，不要返回 NO_REPLY。',
    ].join('\n')
  } else {
    prompt = userMessage
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

  console.log(`   🔍 [inject] HTTP ${httpStatus} | sessionKey=${getSessionKey()}`)

  if (httpStatus >= 400) {
    throw new Error(`Gateway HTTP ${httpStatus}: ${raw.slice(0, 200)}`)
  }

  return extractReply(raw)
}

/**
 * 从 sessions_send 响应提取回复文本（inject 专用）
 */
function extractReply(raw) {
  let parsed
  try { parsed = JSON.parse(raw) } catch {
    console.error('   ❌ 响应非 JSON:', raw.slice(0, 200))
    return ''
  }

  if (parsed?.ok === false || parsed?.error) {
    const code = parsed?.error?.code || 'UNKNOWN'
    const msg = parsed?.error?.message || parsed?.error || 'unknown'
    throw new Error(`Gateway error [${code}]: ${msg}`)
  }

  if (parsed?.status === 'error' || parsed?.status === 'forbidden') {
    throw new Error(`sessions_send ${parsed.status}: ${parsed.error || parsed.message || ''}`)
  }

  let inner = null
  const innerText = parsed?.result?.content?.[0]?.text
  if (innerText) {
    try { inner = JSON.parse(innerText) } catch { inner = null }
  }

  if (inner?.status === 'timeout' || inner?.status === 'error' ||
      parsed?.result?.details?.status === 'timeout' || parsed?.status === 'timeout') {
    return ''
  }

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

module.exports = { inject, spawn, checkHealth, getGatewayToken }
